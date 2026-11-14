/* The three drawings: plan view, tilted 3D view and loop side view. All true scale. */
(function (W) {
  'use strict';
  const M = W.WBX.model, { rot } = W.WBX.kicad;

  const C = { bg: '#0c1311', plate: '#12302b', plateEdge: '#4e7971', land: '#d9a441', landNet: '#e8c465', landDim: '#7c6a3c', paddle: '#3a3320', die: '#1a2826', dieEdge: '#7ba69c', pad: '#d4d4d4', padHi: '#ffffff', sel: '#d93aa7', hi: '#3ea9da', ok: '#36d9bb', warn: '#e8a33d', bad: '#ff6b6b', ghost: '#d93aa7', text: '#d4d4d4', mute: '#7ba69c' };
  const LAYER_STYLE = { 'F.Cu': ['#2c7f6e', 0.42], 'B.Cu': ['#3f52a6', 0.16], 'In1.Cu': ['#54606a', 0.14], 'In2.Cu': ['#54606a', 0.14], 'F.SilkS': ['#e2e8f0', 0.85], 'B.SilkS': ['#768ae5', 0.18], 'F.Mask': ['#b629d6', 0.0], 'Edge.Cuts': ['#bee36d', 1], 'F.Fab': ['#a0a0a0', 0.6], 'B.Fab': ['#606060', 0.2], 'F.CrtYd': ['#c5acfb', 0.4], 'B.CrtYd': ['#768ae5', 0.2], 'Cmts.User': ['#fa8fa2', 0.8], 'Dwgs.User': ['#fbbea2', 0.6], '*': ['#3e6f66', 0.5] };
  const LAYER_ORDER = ['B.Cu', 'In2.Cu', 'In1.Cu', 'F.Cu', 'B.SilkS', 'F.SilkS', 'B.Fab', 'F.Fab', 'B.CrtYd', 'F.CrtYd', 'Dwgs.User', 'Cmts.User', 'Edge.Cuts'];

  // Bake board graphics into per-layer Path2D objects, grouped by stroke width.
  function buildBoardPaths(sub) {
    const layers = new Map();
    const get = name => { let L = layers.get(name); if (!L) { L = { name, fill: new Path2D(), strokes: new Map(), texts: [], any: false }; layers.set(name, L); } return L; };
    const add = g => {
      if (g.kind === 'text') { if (!g.hide && g.layer) get(g.layer).texts.push(g); return; }
      if (g.kind === 'via') { const L = get('*'); L.fill.moveTo(g.x + g.d / 2, g.y); L.fill.arc(g.x, g.y, g.d / 2, 0, 2 * Math.PI); L.any = true; return; }
      if (!g.layer || !g.pts || g.pts.length < 4) return;
      const L = get(g.layer);
      L.any = true;
      const P = new Path2D();
      P.moveTo(g.pts[0], g.pts[1]);
      for (let i = 2; i < g.pts.length; i += 2) P.lineTo(g.pts[i], g.pts[i + 1]);
      if (g.kind === 'poly') { P.closePath(); if (g.fill) L.fill.addPath(P); }
      if (g.w > 0 && !g.zone) { const k = g.w; if (!L.strokes.has(k)) L.strokes.set(k, new Path2D()); L.strokes.get(k).addPath(P); }
    };
    for (const g of sub.board.gfx) add(g);
    for (const fp of sub.board.fps) {
      if (fp.wbKind === 'die' || fp.wbKind === 'wire' || fp.wbKind === 'type_library') continue;
      for (const g of fp.gfx) add(g);
      // copper of every other pad, so the board reads as a board
      for (const p of fp.pads) {
        const L = get(p.layers.some(l => l === 'F.Cu' || l === '*.Cu') ? 'F.Cu' : p.layers.some(l => l === 'B.Cu') ? 'B.Cu' : (p.layers[0] || '*'));
        L.any = true;
        const hw = p.w / 2, hh = p.h / 2, Q = new Path2D();
        const c = (x, y) => { const [a, b] = rot(x, y, p.rot); return [p.x + a, p.y + b]; };
        const pts = [c(-hw, -hh), c(hw, -hh), c(hw, hh), c(-hw, hh)];
        Q.moveTo(...pts[0]); Q.lineTo(...pts[1]); Q.lineTo(...pts[2]); Q.lineTo(...pts[3]); Q.closePath();
        L.fill.addPath(Q);
      }
    }
    sub.paths = layers;
    const names = [...layers.keys()];
    sub.layerNames = names.sort((a, b) => (LAYER_ORDER.indexOf(a) + 1 || 99) - (LAYER_ORDER.indexOf(b) + 1 || 99));
    let b = null;
    const grow = (x, y) => { if (!b) b = [x, y, x, y]; else { if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y; } };
    const edge = sub.board.gfx.filter(g => g.layer === 'Edge.Cuts' && g.pts);
    for (const g of edge) for (let i = 0; i < g.pts.length; i += 2) grow(g.pts[i], g.pts[i + 1]);
    if (!b) for (const fp of sub.board.fps) for (const p of fp.pads) grow(p.x, p.y);
    sub.bounds = b;
    sub.edgePath = null;
  }
  function drawBoard(ctx, sub, vis, zoom) {
    if (!sub.paths) return;
    for (const name of sub.layerNames) {
      if (vis[name] === false) continue;
      const L = sub.paths.get(name), st = LAYER_STYLE[name] || ['#607a72', 0.4];
      if (!st[1]) continue;
      ctx.globalAlpha = st[1];
      ctx.fillStyle = ctx.strokeStyle = st[0];
      ctx.fill(L.fill);
      ctx.lineCap = ctx.lineJoin = 'round';
      for (const [w, P] of L.strokes) { ctx.lineWidth = Math.max(w, name === 'Edge.Cuts' ? 1.2 / zoom : 0.5 / zoom); ctx.stroke(P); }
      for (const t of L.texts) {
        const px = t.size * zoom;
        if (px < 5) continue;
        ctx.save();
        ctx.translate(t.x, t.y);
        ctx.rotate(-t.rot * Math.PI / 180);
        ctx.scale(t.mirror ? -1 : 1, 1);
        ctx.font = `${t.size}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(t.s, 0, 0);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }
  function landPath(ctx, l) {
    ctx.save();
    ctx.translate(l.x, l.y);
    ctx.rotate(-l.rot * Math.PI / 180);
    const w = l.w, h = l.h;
    ctx.beginPath();
    if (l.shape === 'circle') ctx.arc(0, 0, w / 2, 0, 2 * Math.PI);
    else if ((l.shape === 'oval' || l.shape === 'roundrect') && ctx.roundRect) ctx.roundRect(-w / 2, -h / 2, w, h, l.shape === 'oval' ? Math.min(w, h) / 2 : Math.min(w, h) * (l.rr || 0.25));
    else ctx.rect(-w / 2, -h / 2, w, h);
    ctx.restore();
  }
  function drawDie(ctx, slot, opts) {
    const die = slot.die, zoom = opts.zoom;
    ctx.fillStyle = C.die;
    ctx.fillRect(die.x0, die.y0, die.x1 - die.x0, die.y1 - die.y0);
    if (die.artCanvas && opts.art !== false) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(die.artCanvas, die.x0, die.y0, die.x1 - die.x0, die.y1 - die.y0);
    }
    if (die.gfx && die.gfx.length) {
      ctx.strokeStyle = C.mute;
      for (const g of die.gfx) {
        if (!g.pts || g.pts.length < 4) continue;
        ctx.lineWidth = Math.max(g.w || 0, 0.8 / zoom);
        ctx.beginPath(); ctx.moveTo(g.pts[0], g.pts[1]);
        for (let i = 2; i < g.pts.length; i += 2) ctx.lineTo(g.pts[i], g.pts[i + 1]);
        if (g.kind === 'poly') ctx.closePath();
        ctx.stroke();
      }
    }
    // With several die, the selected one's edge is marked, because the panels are talking about it.
    ctx.strokeStyle = opts.marked ? C.hi : C.dieEdge; ctx.lineWidth = (opts.marked ? 2.2 : 1.2) / zoom;
    ctx.strokeRect(die.x0, die.y0, die.x1 - die.x0, die.y1 - die.y0);
    const used = opts.usedPads;
    for (const p of die.pads) {
      const k = 'p' + M.padKey(slot.id, p.num);
      ctx.fillStyle = opts.hover === k || opts.selected === k ? C.padHi : used && !used.has(M.padKey(slot.id, p.num)) ? '#8a8f8d' : C.pad;
      ctx.fillRect(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h);
    }
  }
  // The pads with a wire on them, across every die, or null before there are any wires.
  function padsInUse(S) {
    if (!S.wires.length) return null;
    const used = new Set();
    for (const w of S.wires) for (const k of M.wireEndKeys(S, w)) used.add(k);
    return used;
  }

  class PlanView {
    constructor(canvas, app) {
      this.c = canvas; this.ctx = canvas.getContext('2d'); this.app = app;
      this.vx = 0; this.vy = 0; this.z = 40; this.pointer = null; this.tool = 'select';
      this.hover = null; this.rubber = null; this.mouse = [0, 0]; this.vis = {}; this.show = { art: true, labels: true, board: true, wires: true };
      this.fitted = false;
      const on = (t, f) => canvas.addEventListener(t, f.bind(this));
      on('pointerdown', this.down); on('pointermove', this.move); on('pointerup', this.up); on('wheel', this.wheel);
      on('pointerleave', () => { this.hover = null; this.app.hideTip(); this.draw(); });
      on('dblclick', this.dbl);
      new ResizeObserver(() => { this.resize(); }).observe(canvas.parentElement);
      this.resize();
    }
    resize() {
      const r = this.c.parentElement.getBoundingClientRect(), d = W.devicePixelRatio || 1;
      this.w = r.width; this.h = r.height; this.d = d;
      this.c.width = Math.max(1, r.width * d); this.c.height = Math.max(1, r.height * d);
      this.c.style.width = r.width + 'px'; this.c.style.height = r.height + 'px';
      if (!this.fitted) this.fit(); else this.draw();
    }
    bounds() {
      const S = this.app.S;
      let b = null;
      const grow = (x, y) => { if (!b) b = [x, y, x, y]; else { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); } };
      if (S.lands.length) for (const l of S.lands) { const r = Math.max(l.w, l.h); grow(l.x - r, l.y - r); grow(l.x + r, l.y + r); }
      for (const d of M.placedDies(S)) for (const [x, y] of [[d.die.x0, d.die.y0], [d.die.x1, d.die.y1]]) { const q = M.dieToBoard(d.place, x, y); grow(q[0], q[1]); }
      if (!b && S.substrate && S.substrate.bounds) b = S.substrate.bounds.slice();
      return b;
    }
    fit() {
      const b = this.bounds();
      if (!b || !this.w) { this.draw(); return; }
      const m = 1.15, bw = Math.max(b[2] - b[0], 0.1), bh = Math.max(b[3] - b[1], 0.1);
      this.z = Math.min(this.w / (bw * m), this.h / (bh * m));
      this.vx = (b[0] + b[2]) / 2 - this.w / 2 / this.z;
      this.vy = (b[1] + b[3]) / 2 - this.h / 2 / this.z;
      this.fitted = true;
      this.draw();
    }
    toWorld(sx, sy) { return [sx / this.z + this.vx, sy / this.z + this.vy]; }
    toScreen(x, y) { return [(x - this.vx) * this.z, (y - this.vy) * this.z]; }
    draw() {
      if (this.pending) return;
      this.pending = true;
      W.requestAnimationFrame(() => { this.pending = false; this.paint(); });
    }
    paint() {
      const ctx = this.ctx, S = this.app.S, d = this.d, z = this.z;
      ctx.setTransform(d, 0, 0, d, 0, 0);
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, this.w, this.h);
      const dies = M.placedDies(S), many = dies.length > 1;
      if (!S.substrate && !dies.length) return;
      ctx.setTransform(d * z, 0, 0, d * z, -this.vx * z * d, -this.vy * z * d);

      if (S.substrate && this.show.board) drawBoard(ctx, S.substrate, this.vis, z);
      if (S.paddle) { ctx.fillStyle = C.paddle; const l = S.paddle; landPath(ctx, l); ctx.fill(); }
      const usedL = new Set(S.wires.map(w => w.land));
      for (const l of S.lands) {
        const k = 'l' + l.id;
        ctx.fillStyle = this.hover === k || this.app.sel === k ? '#fff0c8' : usedL.has(l.id) || !S.wires.length ? C.land : C.landDim;
        landPath(ctx, l); ctx.fill();
      }
      // Lowest first, so a die covers what is under it.
      const used = padsInUse(S);
      for (const o of M.stackOrder(S)) {
        ctx.save();
        ctx.translate(o.place.x, o.place.y);
        ctx.rotate(-o.place.rot * Math.PI / 180);
        drawDie(ctx, o, { zoom: z, hover: this.hover, selected: this.app.sel, art: this.show.art, usedPads: used, marked: many && o.id === S.active });
        ctx.restore();
      }
      if (this.show.wires && dies.length) this.paintWires(ctx);

      ctx.setTransform(d, 0, 0, d, 0, 0);
      for (const o of dies) this.paintMarks(ctx, o, many);
      if (this.show.labels) this.paintLabels(ctx);
      this.paintOverlay(ctx);
    }
    paintWires(ctx) {
      const S = this.app.S, z = this.z;
      ctx.lineCap = 'round';
      const flagged = this.app.flagged || new Set();
      const seg = (e, width, col) => { ctx.strokeStyle = col; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(e.a[0], e.a[1]); ctx.lineTo(e.b[0], e.b[1]); ctx.stroke(); };
      if (this.app.preview) {
        ctx.setLineDash([6 / z, 4 / z]);
        for (const w of this.app.preview) { const e = M.wireEnds(S, w); if (e) seg(e, 1.4 / z, C.ghost); }
        ctx.setLineDash([]);
      }
      for (const w of S.wires) {
        const e = M.wireEnds(S, w);
        if (!e) continue;
        const T = M.typeOf(S, w.type), d = T.d / 1000;
        const isSel = this.app.selWires.has(w), isHov = this.hover === w, isFlag = flagged.has(w);
        if (isSel || isHov || isFlag) seg(e, Math.max(d, 1 / z) + 3 / z, isSel ? C.sel : isFlag ? C.bad : C.hi);
        // A generic or undefined wire has the same dot at both ends: which end is bonded first is the bonder's call too. Undefined is dashed, generic solid.
        const open = M.isBonderChoice(T);
        if (M.isUndefinedType(T)) ctx.setLineDash([6 / z, 4 / z]);
        seg(e, Math.max(d, 1.1 / z), T.colour || C.land);
        ctx.setLineDash([]);
        const fa = T.dir === 'reverse' ? e.b : e.a, sa = T.dir === 'reverse' ? e.a : e.b;
        ctx.fillStyle = T.colour || C.land;
        ctx.beginPath(); ctx.arc(fa[0], fa[1], Math.max(d * 1.3, 1.6 / z), 0, 2 * Math.PI); ctx.fill();
        if (open) { ctx.beginPath(); ctx.arc(sa[0], sa[1], 1.6 / z, 0, 2 * Math.PI); ctx.fill(); continue; }
        ctx.save(); ctx.translate(sa[0], sa[1]);
        ctx.rotate(Math.atan2(e.b[1] - e.a[1], e.b[0] - e.a[0]));
        const wl = Math.max(d * 1.8, 2.4 / z), wh = Math.max(d * 0.8, 1.2 / z);
        ctx.fillRect(-wl / 2, -wh / 2, wl, wh);
        ctx.restore();
      }
    }
    paintMarks(ctx, slot, many) {
      const die = slot.die;
      if (many) {
        // The die's name at a corner, so the wire list and panels can be read against the picture.
        const [sx, sy] = this.toScreen(...M.dieToBoard(slot.place, die.x0, die.y0));
        ctx.font = 'bold 13px "IBM Plex Sans", system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillStyle = slot.id === this.app.S.active ? C.hi : C.dieEdge;
        ctx.fillText(slot.id, sx + 4, sy + 4);
      }
      if (!die.pads.length) return;
      const p = die.pads.find(q => parseInt(q.num, 10) === 1) || die.pads[0];
      const [sx, sy] = this.toScreen(...M.dieToBoard(slot.place, p.x, p.y));
      // pin 1: a marker with an arrow toward pad 2, showing the numbering direction
      ctx.strokeStyle = C.sel; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sx, sy, Math.max(7, Math.max(p.w, p.h) * this.z * 0.8), 0, 2 * Math.PI); ctx.stroke();
      const next = die.pads.find(q => parseInt(q.num, 10) === 2);
      if (next) {
        const [nx, ny] = this.toScreen(...M.dieToBoard(slot.place, next.x, next.y));
        const a = Math.atan2(ny - sy, nx - sx), L = Math.max(30, Math.min(70, 8 * this.z * Math.hypot(p.x - next.x, p.y - next.y) / 2));
        const R = Math.max(7, Math.max(p.w, p.h) * this.z * 0.8);
        const x0 = sx + Math.cos(a) * (R + 3), y0 = sy + Math.sin(a) * (R + 3), x1 = sx + Math.cos(a) * (R + 3 + L), y1 = sy + Math.sin(a) * (R + 3 + L);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
        ctx.moveTo(x1, y1); ctx.lineTo(x1 - Math.cos(a - 0.5) * 8, y1 - Math.sin(a - 0.5) * 8);
        ctx.moveTo(x1, y1); ctx.lineTo(x1 - Math.cos(a + 0.5) * 8, y1 - Math.sin(a + 0.5) * 8);
        ctx.stroke();
      }
      ctx.font = 'bold 12px "IBM Plex Sans", system-ui, sans-serif';
      ctx.fillStyle = C.sel; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText('pad ' + p.num, sx + 10, sy - 10);
    }
    paintLabels(ctx) {
      const S = this.app.S, z = this.z;
      const vis = (x, y) => x > -40 && y > -40 && x < this.w + 40 && y < this.h + 40;
      ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
      const dies = M.placedDies(S);
      for (const o of dies) {
        const side = o.die.pads.length ? Math.min(...o.die.pads.map(p => Math.min(p.w, p.h))) * z : 0;
        if (side >= 16) {
          ctx.font = `${Math.min(13, side * 0.32)}px "IBM Plex Mono", ui-monospace, monospace`;
          // A pad under a higher die can't be seen, so neither can its number.
          const higher = dies.filter(q => q !== o && M.dieBase(S, q) >= M.dieTop(S, o) - 1e-6);
          for (const p of o.die.pads) {
            const q = M.dieToBoard(o.place, p.x, p.y), [sx, sy] = this.toScreen(...q);
            if (!vis(sx, sy) || higher.some(h => M.inOutline(h, q))) continue;
            ctx.fillStyle = '#0c1311';
            ctx.fillText(p.num, sx, sy - (p.net && side > 44 ? 7 : 0));
            if (p.net && side > 44) { ctx.font = `${Math.min(10, side * 0.15)}px "IBM Plex Mono", ui-monospace, monospace`; ctx.fillText(p.net.slice(0, 14), sx, sy + 7); ctx.font = `${Math.min(13, side * 0.32)}px "IBM Plex Mono", ui-monospace, monospace`; }
          }
        }
      }
      if (S.lands.length) {
        const short = Math.min(...S.lands.map(l => Math.min(l.w, l.h))) * z;
        if (short >= 11) {
          ctx.font = `${Math.min(12, short * 0.55)}px "IBM Plex Mono", ui-monospace, monospace`;
          // A land's number goes on the side away from the die, or the middle of them when there are several.
          const mids = dies.map(o => M.dieToBoard(o.place, ...M.dieCentre(o.die)));
          const mid = mids.length ? [mids.reduce((a, q) => a + q[0], 0) / mids.length, mids.reduce((a, q) => a + q[1], 0) / mids.length] : null;
          for (const l of S.lands) {
            const { ux, uy, long } = M.landAxis(l);
            const [cx, cy] = mid || [l.x, l.y];
            const a = [l.x + ux * long / 2, l.y + uy * long / 2], b = [l.x - ux * long / 2, l.y - uy * long / 2];
            const outer = Math.hypot(a[0] - cx, a[1] - cy) > Math.hypot(b[0] - cx, b[1] - cy) ? a : b;
            const sgn = outer === a ? -1 : 1;
            const [sx, sy] = this.toScreen(outer[0] + sgn * ux * long * 0.2, outer[1] + sgn * uy * long * 0.2);
            if (!vis(sx, sy)) continue;
            ctx.fillStyle = '#0c1311';
            ctx.save(); ctx.translate(sx, sy);
            const ang = Math.atan2(uy, ux);
            ctx.rotate(Math.abs(ang) > Math.PI / 2 + 1e-6 ? ang - Math.PI : ang);
            ctx.fillText(String(l.id).replace(/\.1$/, ''), 0, 0);
            ctx.restore();
          }
        }
      }
    }
    paintOverlay(ctx) {
      const S = this.app.S;
      // End handles belong to a single selected wire; several selected have none, so a drag can't move one of them by surprise.
      const w = this.app.selWires.size > 1 ? null : this.app.selWire, e = w && M.wireEnds(S, w);
      if (e) {
        ctx.fillStyle = '#fff'; ctx.strokeStyle = C.sel; ctx.lineWidth = 2;
        for (const q of [e.a, e.b]) { const [x, y] = this.toScreen(...q); ctx.beginPath(); ctx.rect(x - 4.5, y - 4.5, 9, 9); ctx.fill(); ctx.stroke(); }
      }
      if (this.rubber) {
        const [x0, y0] = this.toScreen(...this.rubber.at), [x1, y1] = this.mouse;
        ctx.strokeStyle = C.sel; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.setLineDash([]);
      }
      // scale bar
      const units = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50];
      let u = units[0];
      for (const v of units) if (v * this.z <= 160) u = v;
      const px = u * this.z, x = 16, y = this.h - 18;
      ctx.strokeStyle = C.text; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + px, y); ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4); ctx.moveTo(x + px, y - 4); ctx.lineTo(x + px, y + 4); ctx.stroke();
      ctx.fillStyle = C.text; ctx.font = '12px "IBM Plex Sans", system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText(u < 1 ? `${u * 1000} µm` : `${u} mm`, x, y - 6);
    }

    /* ---- what is under the cursor ---- */
    hit(sx, sy) {
      const S = this.app.S, [x, y] = this.toWorld(sx, sy), tol = 4 / this.z;
      const selW = this.app.selWires.size > 1 ? null : this.app.selWire;
      if (selW) {
        const e = M.wireEnds(S, selW);
        if (e) {
          if (Math.hypot(e.a[0] - x, e.a[1] - y) < 8 / this.z) return { kind: 'handle', end: 'a', w: selW };
          if (Math.hypot(e.b[0] - x, e.b[1] - y) < 8 / this.z) return { kind: 'handle', end: 'b', w: selW };
        }
      }
      // Top down: a die's pads, then its body hides any lower die's pads.
      const top = M.stackOrder(S).reverse();
      for (const o of top) {
        const [lx, ly] = M.boardToDie(o.place, x, y);
        for (const p of o.die.pads) if (Math.abs(lx - p.x) <= p.w / 2 + tol && Math.abs(ly - p.y) <= p.h / 2 + tol) return { kind: 'pad', pad: p, slot: o };
        if (lx >= o.die.x0 && lx <= o.die.x1 && ly >= o.die.y0 && ly <= o.die.y1) break;
      }
      for (const l of S.lands) if (M.pointToLand([x, y], l) <= tol) return { kind: 'land', land: l };
      let best = null, bd = 5 / this.z;
      for (const w of S.wires) {
        const e = M.wireEnds(S, w);
        if (!e) continue;
        const dx = e.b[0] - e.a[0], dy = e.b[1] - e.a[1], t = Math.max(0, Math.min(1, ((x - e.a[0]) * dx + (y - e.a[1]) * dy) / (dx * dx + dy * dy || 1)));
        const dd = Math.hypot(x - e.a[0] - t * dx, y - e.a[1] - t * dy);
        if (dd < bd) { bd = dd; best = w; }
      }
      if (best) return { kind: 'wire', w: best };
      for (const o of top) {
        const [lx, ly] = M.boardToDie(o.place, x, y);
        if (lx >= o.die.x0 && lx <= o.die.x1 && ly >= o.die.y0 && ly <= o.die.y1) return { kind: 'die', slot: o };
      }
      return null;
    }
    keyOf(h) { return !h ? null : h.kind === 'pad' ? 'p' + M.padKey(h.slot.id, h.pad.num) : h.kind === 'land' ? 'l' + h.land.id : h.kind === 'wire' ? h.w : null; }
    pos(ev) { const r = this.c.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; }
    down(ev) {
      const [sx, sy] = this.pos(ev), S = this.app.S;
      this.c.setPointerCapture(ev.pointerId);
      const h = this.hit(sx, sy);
      if (ev.button === 1 || ev.button === 2 || this.spaceDown) { this.pointer = { mode: 'pan', sx, sy, vx: this.vx, vy: this.vy }; return; }
      if (h && h.kind === 'handle') { this.pointer = { mode: 'end', end: h.end, w: h.w, moved: false }; return; }
      if (this.tool === 'move' && h && (h.kind === 'die' || h.kind === 'pad')) {
        this.app.selectDie(h.slot.id);
        const [x, y] = this.toWorld(sx, sy);
        this.pointer = { mode: 'die', ox: S.place.x - x, oy: S.place.y - y };
        return;
      }
      this.pointer = { mode: 'press', sx, sy, vx: this.vx, vy: this.vy, h, moved: false };
    }
    move(ev) {
      const [sx, sy] = this.pos(ev);
      this.mouse = [sx, sy];
      const P = this.pointer, S = this.app.S;
      const [wx, wy] = this.toWorld(sx, sy);
      this.app.status(wx, wy);
      if (P) {
        if (P.mode === 'pan' || P.mode === 'press') {
          if (P.mode === 'press' && Math.hypot(sx - P.sx, sy - P.sy) > 4) P.moved = true;
          if (P.mode === 'pan' || P.moved) { this.vx = P.vx - (sx - P.sx) / this.z; this.vy = P.vy - (sy - P.sy) / this.z; this.draw(); }
        } else if (P.mode === 'die') {
          this.app.setPlace({ x: wx + P.ox, y: wy + P.oy });
          this.app.onGeometry(true);
        } else if (P.mode === 'end') {
          P.moved = true;
          const e = M.wireEnds(S, P.w);
          if (P.end === 'a') { const [lx, ly] = M.boardToDie(e.die.place, wx, wy); P.w.padOff = [lx - e.pad.x, ly - e.pad.y]; }
          else if (e.toPad) { const [lx, ly] = M.boardToDie(e.toDie.place, wx, wy); P.w.toPadOff = [lx - e.toPad.x, ly - e.toPad.y]; }
          else { const ax = M.landAxis(e.land), dx = wx - e.land.x, dy = wy - e.land.y; P.w.landOff = [dx * ax.ux + dy * ax.uy, -dx * ax.uy + dy * ax.ux]; }
          P.w.pinned = true;
          this.app.onGeometry(true);
        }
        return;
      }
      const h = this.hit(sx, sy), k = this.keyOf(h);
      this.c.style.cursor = this.tool === 'wire' ? 'crosshair' : h && h.kind === 'handle' ? 'grab' : this.tool === 'move' && h && (h.kind === 'die' || h.kind === 'pad') ? 'move' : h && h.kind !== 'die' ? 'pointer' : 'default';
      if (k !== this.hover) { this.hover = k; this.draw(); }
      if (this.rubber) this.draw();
      this.app.showTip(h, ev.clientX, ev.clientY);
    }
    up(ev) {
      const P = this.pointer;
      this.pointer = null;
      if (!P) return;
      if (P.mode === 'die' || P.mode === 'end') { this.app.onGeometry(false); return; }
      if (P.mode === 'press' && !P.moved) this.app.onClick(P.h, ev);
    }
    dbl(ev) { const [sx, sy] = this.pos(ev); const h = this.hit(sx, sy); if (!h) this.fit(); }
    wheel(ev) {
      ev.preventDefault();
      const [sx, sy] = this.pos(ev), [x, y] = this.toWorld(sx, sy);
      this.z = Math.max(1, Math.min(20000, this.z * Math.exp(-ev.deltaY * 0.0016)));
      this.vx = x - sx / this.z; this.vy = y - sy / this.z;
      this.draw();
    }
  }

  /* ---- tilted view: an orbiting orthographic projection, so every flat plane is an affine map and artwork draws exactly ---- */
  class TiltView {
    constructor(canvas, app) {
      this.c = canvas; this.ctx = canvas.getContext('2d'); this.app = app;
      this.yaw = -25; this.pitch = 52; this.z = 40; this.zExag = 1; this.cx = 0; this.cy = 0;
      canvas.addEventListener('pointerdown', ev => { canvas.setPointerCapture(ev.pointerId); this.drag = { x: ev.clientX, y: ev.clientY, yaw: this.yaw, pitch: this.pitch, pan: ev.button !== 0, cx: this.cx, cy: this.cy, side: ev.clientY - canvas.getBoundingClientRect().top > this.h / 2 + this.cy ? -1 : 1 }; });
      canvas.addEventListener('pointermove', ev => {
        if (!this.drag) return;
        const D = this.drag, dx = ev.clientX - D.x, dy = ev.clientY - D.y;
        if (D.pan) { this.cx = D.cx + dx; this.cy = D.cy + dy; }
        // Move the part of the board that was grabbed with the cursor. The near and far halves move opposite ways under both yaw and pitch, so the side of the pivot pressed sets both signs, locked for the whole drag.
        else { this.yaw = D.yaw + D.side * dx * 0.35; this.pitch = Math.max(8, Math.min(90, D.pitch - D.side * dy * 0.3)); }
        this.draw();
      });
      canvas.addEventListener('pointerup', () => { this.drag = null; });
      // Beside the orbit: a left press that stays within 4 px is a click on what was under it, and leaves the view where it was.
      const at = ev => { const r = canvas.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
      canvas.addEventListener('pointerdown', ev => { this.press = ev.button === 0 ? { x: ev.clientX, y: ev.clientY, yaw: this.yaw, pitch: this.pitch, w: this.hit(...at(ev)) } : null; });
      canvas.addEventListener('pointermove', ev => {
        if (this.press && Math.hypot(ev.clientX - this.press.x, ev.clientY - this.press.y) > 4) this.press = null;
        canvas.style.cursor = !this.drag && this.hit(...at(ev)) ? 'pointer' : '';
      });
      canvas.addEventListener('pointerup', ev => {
        const P = this.press;
        this.press = null;
        if (!P) return;
        this.yaw = P.yaw; this.pitch = P.pitch;
        this.app.onClick(P.w ? { kind: 'wire', w: P.w } : null, ev);
      });
      canvas.addEventListener('wheel', ev => { ev.preventDefault(); this.z = Math.max(4, Math.min(2000, this.z * Math.exp(-ev.deltaY * 0.0016))); this.draw(); });
      canvas.addEventListener('contextmenu', ev => ev.preventDefault());
      new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
      this.resize();
    }
    resize() {
      const r = this.c.parentElement.getBoundingClientRect(), d = W.devicePixelRatio || 1;
      this.w = r.width; this.h = r.height; this.d = d;
      if (!r.width) return;
      this.c.width = r.width * d; this.c.height = r.height * d;
      this.c.style.width = r.width + 'px'; this.c.style.height = r.height + 'px';
      this.draw();
    }
    fit() {
      const S = this.app.S;
      const b = this.app.plan.bounds();
      this.cx = this.cy = 0;
      if (b) this.z = Math.min(this.w, this.h) / (Math.max(b[2] - b[0], b[3] - b[1]) * 1.25);
      this.draw();
    }
    // The pivot. With several die it's the middle of them all, so selecting a different die doesn't swing the view.
    centre() {
      const S = this.app.S, dies = M.placedDies(S);
      if (dies.length === 1) return M.dieToBoard(dies[0].place, ...M.dieCentre(dies[0].die));
      if (dies.length) { const P = dies.flatMap(M.dieCorners), X = P.map(q => q[0]), Y = P.map(q => q[1]); return [(Math.min(...X) + Math.max(...X)) / 2, (Math.min(...Y) + Math.max(...Y)) / 2]; }
      const b = this.app.plan.bounds();
      return b ? [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] : [0, 0];
    }
    // Projected coordinates of a point: x, y in board mm, h in mm above the board's top.
    project(x, y, h) {
      const [ox, oy] = this.c0, a = this.yaw * Math.PI / 180, p = this.pitch * Math.PI / 180;
      const X = (x - ox) * Math.cos(a) - (y - oy) * Math.sin(a), Y = (x - ox) * Math.sin(a) + (y - oy) * Math.cos(a);
      return [X * this.z + this.w / 2 + this.cx, Y * Math.sin(p) * this.z - h * this.zExag * Math.cos(p) * this.z + this.h / 2 + this.cy, Y];
    }
    plane(h) {
      const a = this.yaw * Math.PI / 180, p = this.pitch * Math.PI / 180, z = this.z, d = this.d, [ox, oy] = this.c0;
      const A = Math.cos(a) * z, B = Math.sin(a) * Math.sin(p) * z, Cc = -Math.sin(a) * z, Dd = Math.cos(a) * Math.sin(p) * z;
      const E = this.w / 2 + this.cx - A * ox - Cc * oy, F = this.h / 2 + this.cy - h * this.zExag * Math.cos(p) * z - B * ox - Dd * oy;
      this.ctx.setTransform(A * d, B * d, Cc * d, Dd * d, E * d, F * d);
    }
    draw() { if (this.pending) return; this.pending = true; W.requestAnimationFrame(() => { this.pending = false; if (this.app.mode === '3d') this.paint(); }); }
    paint() {
      const ctx = this.ctx, S = this.app.S, d = this.d;
      ctx.setTransform(d, 0, 0, d, 0, 0);
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, this.w, this.h);
      this.rows = null;
      if (!S.substrate && !M.placedDies(S).length) return;
      this.c0 = this.centre();
      this.plane(0);
      if (S.substrate) {
        if (S.substrate.bounds && S.substrate.board.gfx.some(g => g.layer === 'Edge.Cuts')) {
          const b = S.substrate.bounds;
          ctx.fillStyle = C.plate; ctx.fillRect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
        } else {
          const b = this.app.plan.bounds();
          if (b) { const m = 1; ctx.fillStyle = C.plate; ctx.fillRect(b[0] - m, b[1] - m, b[2] - b[0] + 2 * m, b[3] - b[1] + 2 * m); }
        }
        drawBoard(ctx, S.substrate, this.app.plan.vis, this.z);
      }
      for (const l of S.lands) { ctx.fillStyle = C.land; landPath(ctx, l); ctx.fill(); }
      const many = M.placedDies(S).length > 1;
      for (const o of this.paintOrder()) this.paintDie(o, many);
      this.paintWires();
    }
    /* The order to paint die in. Where two overlap in plan, the lower goes first, so stacking reads right from any angle.
       Where they don't, the one farther from the viewer goes first, so a tall die in front can hide a die behind it. */
    paintOrder() {
      const S = this.app.S, left = M.stackOrder(S), out = [];
      const depth = o => { const c = M.dieToBoard(o.place, ...M.dieCentre(o.die)); return this.project(c[0], c[1], 0)[2]; };
      const before = (a, b) => M.outlinesOverlap(a, b) ? M.dieBottom(S, a) < M.dieBottom(S, b) : depth(a) < depth(b);
      while (left.length) {
        const k = left.findIndex(a => !left.some(b => b !== a && before(b, a)));
        out.push(left.splice(k < 0 ? 0 : k, 1)[0]);
      }
      return out;
    }
    paintDie(o, many) {
      const ctx = this.ctx, S = this.app.S, die = o.die, top = M.dieTop(S, o) / 1000, base = M.dieBase(S, o) / 1000;
      const cs = M.dieCorners(o);
      const d = this.d;
      ctx.setTransform(d, 0, 0, d, 0, 0);
      // faces toward the viewer only: the outward normal has to point down the screen
      const faces = [];
      for (let i = 0; i < 4; i++) {
        const a = cs[i], b = cs[(i + 1) % 4], P = [this.project(a[0], a[1], base), this.project(b[0], b[1], base), this.project(b[0], b[1], top), this.project(a[0], a[1], top)];
        faces.push({ P, depth: (P[0][2] + P[1][2]) / 2, shade: i });
      }
      faces.sort((f, g) => f.depth - g.depth);
      for (const f of faces.slice(2)) {
        ctx.fillStyle = f.shade % 2 ? '#2b3a37' : '#1f2c2a';
        ctx.beginPath(); f.P.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.closePath(); ctx.fill();
      }
      this.plane(top);
      const saved = ctx.getTransform();
      ctx.translate(o.place.x, o.place.y);
      ctx.rotate(-o.place.rot * Math.PI / 180);
      drawDie(ctx, o, { zoom: this.z, art: true, marked: many && o.id === S.active });
      ctx.setTransform(saved);
    }
    paintWires() {
      const ctx = this.ctx, S = this.app.S, d = this.d, sin = Math.sin(this.pitch * Math.PI / 180);
      ctx.setTransform(d, 0, 0, d, 0, 0);
      const rows = [];
      for (const w of S.wires) {
        const e = M.wireEnds(S, w);
        if (!e) continue;
        const pf = M.wireProfile(S, w, e), ux = (e.b[0] - e.a[0]) / (e.len || 1), uy = (e.b[1] - e.a[1]) / (e.len || 1);
        const pts = pf.curve.map(p => { const s = (pf.reverse ? pf.span - p[0] : p[0]) / 1000; return this.project(e.a[0] + ux * s, e.a[1] + uy * s, p[1] / 1000); });
        rows.push({ w, pf, pts, depth: pts.reduce((a, q) => a + q[2], 0) / pts.length });
      }
      // Far to near, with the selected wires after the rest and the primary one last, so nothing hides them.
      const sel = this.app.selWire, many = this.app.selWires, one = many.size > 1 ? null : sel;
      const rank = w => w === sel ? 2 : many.has(w) ? 1 : 0;
      rows.sort((a, b) => rank(a.w) - rank(b.w) || a.depth - b.depth);
      this.rows = rows;
      ctx.lineCap = ctx.lineJoin = 'round';
      for (const r of rows) {
        const lw = Math.max((r.pf.choice ? M.CHOICE_TUBE_UM : r.pf.type.d) / 1000 * this.z, 1.1);
        const path = () => { ctx.beginPath(); r.pts.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); };
        if (many.has(r.w)) { ctx.strokeStyle = C.sel; ctx.lineWidth = lw + 3; path(); ctx.stroke(); }
        else { ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = lw + 1; path(); ctx.stroke(); }
        ctx.strokeStyle = r.pf.type.colour || C.land; ctx.lineWidth = lw;
        if (r.pf.dashed) ctx.setLineDash([6, 4]);   // undefined: nobody has said anything about this wire
        path(); ctx.stroke(); ctx.setLineDash([]);
        if (r.w === one) {
          ctx.fillStyle = '#fff'; ctx.strokeStyle = C.sel; ctx.lineWidth = 2;
          for (const q of [r.pts[0], r.pts[r.pts.length - 1]]) { ctx.beginPath(); ctx.rect(q[0] - 4.5, q[1] - 4.5, 9, 9); ctx.fill(); ctx.stroke(); }
        }
      }
    }
    // The wire nearest a screen point, from the points last painted, so it always matches the picture, zExag included. Hover runs this on every move, so it does no model work.
    hit(sx, sy) {
      let best = null, bd = Infinity;
      for (const r of this.rows || []) {
        const tol = Math.max((r.pf.choice ? M.CHOICE_TUBE_UM : r.pf.type.d) / 1000 * this.z, 1.1) / 2 + 4, lim = tol * tol, P = r.pts;
        for (let i = 1; i < P.length; i++) {
          const ax = P[i - 1][0], ay = P[i - 1][1], dx = P[i][0] - ax, dy = P[i][1] - ay;
          const t = Math.max(0, Math.min(1, ((sx - ax) * dx + (sy - ay) * dy) / (dx * dx + dy * dy || 1)));
          const ex = sx - ax - t * dx, ey = sy - ay - t * dy, dd = ex * ex + ey * ey;
          if (dd <= lim && dd <= bd) { bd = dd; best = r.w; }
        }
      }
      return best;
    }
  }

  /* ---- side view of one wire, true scale ---- */
  const app_selected = w => W.WBX.app.selWire === w;
  function drawLoop(canvas, S, w, e) {
    const r = canvas.parentElement.getBoundingClientRect(), d = W.devicePixelRatio || 1;
    if (!r.width || !r.height) return;
    canvas.width = r.width * d; canvas.height = r.height * d;
    canvas.style.width = r.width + 'px'; canvas.style.height = r.height + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, r.width, r.height);
    if (!w || !e) {
      ctx.fillStyle = C.mute; ctx.font = '13px "IBM Plex Sans", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('Select a wire to see its loop at true scale', r.width / 2, r.height / 2);
      return;
    }
    const p = M.wireProfile(S, w, e), mL = 56, mR = 24, H = r.height;
    // Every die this wire bonds to or runs over, cut through along the wire, lowest first.
    const cuts = [];
    for (const o of M.stackOrder(S)) {
      if (o === e.die) { cuts.push({ o, x0: 0, x1: X => X(p.exit) }); continue; }
      if (o === e.toDie) { const iv = M.clipToDie(o, e.a, e.b); cuts.push({ o, x0: X => iv && iv[0] * 1000 > 1e-3 ? X(iv[0] * 1000) : X(p.span) - 8, x1: () => r.width }); continue; }
      const iv = M.clipToDie(o, e.a, e.b);
      if (iv) cuts.push({ o, x0: X => iv[0] <= 1e-6 ? 0 : X(iv[0] * 1000), x1: X => iv[1] * 1000 >= p.span - 1e-3 ? r.width : X(iv[1] * 1000) });
    }
    const tops = cuts.map(c => M.dieTop(S, c.o));
    const maxZ = Math.max(p.peak, p.zTop, ...tops) * 1.25, s = Math.min((r.width - mL - mR) / (p.span + 200), (H - 44) / maxZ);
    const X = x => mL + (x + 100) * s, Z = z => H - 22 - z * s;
    // Drawn with the die at the left, so forward and reverse loops compare directly.
    const flip = q => p.reverse ? p.span - q : q;
    ctx.fillStyle = '#12302b'; ctx.fillRect(0, Z(0), r.width, H - Z(0));
    ctx.strokeStyle = C.plateEdge; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, Z(0)); ctx.lineTo(r.width, Z(0)); ctx.stroke();
    const dieEnd = p.worst.s;
    for (const c of cuts) {
      const a = typeof c.x0 === 'function' ? c.x0(X) : c.x0, b = c.x1(X), base = M.dieBase(S, c.o), bot = M.dieBottom(S, c.o), top = M.dieTop(S, c.o);
      ctx.fillStyle = '#4a4f4d'; ctx.fillRect(a, Z(bot), b - a + 2, Z(base) - Z(bot));
      ctx.fillStyle = '#2b3a37'; ctx.fillRect(a, Z(top), b - a, Z(bot) - Z(top));
      ctx.strokeStyle = C.dieEdge; ctx.strokeRect(a, Z(top), b - a, Z(bot) - Z(top));
    }
    if (e.land) { ctx.fillStyle = C.land; ctx.fillRect(X(p.span) - 40 * s, Z(0) - 2, 80 * s, 3); }
    else { ctx.fillStyle = C.pad; ctx.fillRect(X(p.span) - e.toPad.w * 500 * s, Z(p.zEnd) - 2, e.toPad.w * 1000 * s, 3); }
    ctx.fillStyle = C.pad; ctx.fillRect(X(0) - e.pad.w * 500 * s, Z(p.zTop) - 2, e.pad.w * 1000 * s, 3);
    ctx.strokeStyle = p.type.colour || C.land; ctx.lineWidth = Math.max(1.6, p.type.d * s); ctx.lineCap = ctx.lineJoin = 'round';
    if (p.dashed) ctx.setLineDash([6, 4]);
    ctx.beginPath();
    p.curve.forEach((q, i) => { const x = X(flip(q[0])), y = Z(q[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke(); ctx.setLineDash([]);
    // annotations
    ctx.font = '11.5px "IBM Plex Mono", ui-monospace, monospace'; ctx.fillStyle = C.text; ctx.textBaseline = 'alphabetic';
    if (p.choice) {
      // No clearance or peak to report: those numbers would only describe the stand-in path.
      ctx.textAlign = 'right';
      ctx.fillText(`${M.typeLabel(p.type.name)}  stand-in path, not a loop  span ≈${p.span.toFixed(0)} µm`, r.width - 10, 16);
    } else {
      const cx = X(dieEnd), wx = p.worst, many = M.placedDies(S).length > 1;
      ctx.strokeStyle = p.clearance < S.limits.edgeUm ? C.bad : C.ok; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(cx, Z(wx.ref)); ctx.lineTo(cx, Z(wx.z)); ctx.stroke(); ctx.setLineDash([]);
      ctx.textAlign = 'left';
      ctx.fillStyle = p.clearance < S.limits.edgeUm ? C.bad : C.ok;
      ctx.fillText(`${p.clearance.toFixed(0)} µm ${wx.kind === 'under' ? 'under' : 'over the edge'}${many ? ' of ' + wx.d.id : ''}`, cx + 6, Z((wx.ref * 0.6 + wx.z * 0.4)));
      ctx.fillStyle = C.text; ctx.textAlign = 'right';
      ctx.fillText(`${p.type.name}  ${p.type.material} ${p.type.d} µm  ${p.reverse ? 'reverse' : 'forward'}  span ${p.span.toFixed(0)} µm  peak ${p.peak.toFixed(0)} µm`, r.width - 10, 16);
    }
    const ends = M.wireLabels(S, e);
    ctx.textAlign = 'left'; ctx.fillStyle = C.mute;
    ctx.fillText(`${ends.fromWords}${app_selected(w) ? '' : ', the longest wire'}`, 6, 16);
    ctx.textAlign = 'right';
    ctx.fillText(ends.toWords, r.width - 10, H - 6);
  }

  W.WBX.view = { PlanView, TiltView, drawLoop, buildBoardPaths, C };
})(window);
