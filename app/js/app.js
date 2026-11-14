/* The bench: holds the session, loads files, and wires the panels to the model and views. */
(function (W) {
  'use strict';
  const K = W.WBX.kicad, G = W.WBX.gds, M = W.WBX.model, X = W.WBX.export, V = W.WBX.view, DRC = W.WBX.rules;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fx = (v, d) => (+v).toFixed(d === undefined ? 2 : d);
  // A generic or undefined wire's length is the straight distance from pad to land, so it reads as an estimate.
  const fxLen = (w, v) => (M.isBonderChoiceWire(S, w) ? '≈' : '') + fx(v);
  const shortLabel = t => M.isGenericType(t) ? 'Generic' : M.isUndefinedType(t) ? 'Undefined' : M.typeLabel(t.name);
  const typeOptions = (chosen, shortName) => S.types.map(t => `<option value="${esc(t.name)}" ${t.name === chosen ? 'selected' : ''}>${esc(shortName ? shortLabel(t) : M.typeLabel(t.name))}</option>`).join('');

  /* One slot per die. Each carries everything that belongs to that die: its source, its placement and its regime. */
  const newSlot = (id, regime) => ({
    id, die: null, place: { x: 0, y: 0, rot: 0, thick: 280, attach: 25, on: 'board', customUm: 0 }, padBy: new Map(),
    regime: regime || 'number', numberOffset: 0, placeNote: null,
    gdsOpts: { cell: null, padLayer: null, minUm: 30, maxUm: 300, peripheralOnly: true, corner: 'auto', dir: 'ccw', markText: 'ws_ip__(id|qrcode)', firstKey: null, removed: [], artPx: 4096, labelLayer: 'auto' },
    netOverride: {}, dieRemoved: [], dieMode: 'gds', layers: null,
    gds: { lib: null, top: null, file: null, cands: null }, artToken: null,
  });
  const S = {
    substrate: null, dies: [newSlot('D1')], active: 'D1', lands: [], paddle: null, landBy: new Map(),
    wires: [], types: M.DEFAULT_TYPES(), typeRules: [], defaultType: M.GENERIC, rules: DRC.defaults(),
    bond: { mode: 'inner', mm: 0.2 }, boardWires: [], drawn: [], maxLand: 2, landSkip: [], existingDie: null, sidecars: {},
  };
  // S.limits is a view onto S.rules, for code written before the DRC rules. Assigning it, as an old session does, writes into the rules.
  DRC.attach(S);
  // S.die, S.place and the rest read and write the selected die, so whatever acts on one die needs no change for several.
  const slot = () => M.activeDie(S);
  for (const k of ['die', 'place', 'padBy', 'regime', 'numberOffset', 'placeNote', 'gdsOpts', 'netOverride', 'dieRemoved', 'dieMode', 'layers'])
    Object.defineProperty(S, k, { enumerable: false, get: () => slot()[k], set: v => { slot()[k] = v; } });
  const gds = {};
  for (const k of ['lib', 'top', 'file', 'cands']) Object.defineProperty(gds, k, { enumerable: true, get: () => slot().gds[k], set: v => { slot().gds[k] = v; } });
  // Run something as if this die were selected.
  function withDie(d, fn) { const was = S.active; S.active = d.id; try { return fn(); } finally { S.active = was; } }
  const placedDies = () => M.placedDies(S);
  const manyDies = () => placedDies().length > 1;
  // A new name for a die: not one in use, and not a footprint's in the board, which the wires name their ends by.
  function nextDieId() {
    const taken = new Set(S.dies.map(d => d.id));
    if (S.substrate && S.substrate.board) for (const f of S.substrate.board.fps) if (f.wbKind !== 'die') taken.add(f.ref);
    let k = 1;
    while (taken.has('D' + k)) k++;
    return 'D' + k;
  }
  // Keep whatever sits on a die where it is relative to that die, through a move or a turn.
  function carryStack(d, was) {
    const now = d.place;
    if (was.x === now.x && was.y === now.y && was.rot === now.rot) return;
    for (const o of M.stackedOn(S, d)) {
      const [x, y] = M.dieToBoard(now, ...M.boardToDie(was, o.place.x, o.place.y));
      o.place = Object.assign({}, o.place, { x, y, rot: ((o.place.rot + now.rot - was.rot) % 360 + 360) % 360 });
    }
  }
  const app = {
    S, sel: null, selWire: null, flagged: null, flagId: null, preview: null, mode: 'plan', tab: 'regimes', regimes: {}, checks: null,
  };
  W.WBX.app = app;
  /* Wire selection. app.selWires holds every selected wire, by object; app.selWire is the primary one, and setting it selects that wire alone (null clears),
     so code that only knows one wire keeps working. app.anchor is where a Shift range starts. None of it is saved with the session. */
  let primaryWire = null;
  app.selWires = new Set(); app.anchor = null;
  Object.defineProperty(app, 'selWire', {
    enumerable: true,
    get: () => primaryWire,
    set: w => { primaryWire = w || null; app.selWires = new Set(primaryWire ? [primaryWire] : []); app.anchor = primaryWire; },
  });
  function setSel(set, primary, anchor) {
    app.selWires = set;
    primaryWire = set.has(primary) ? primary : [...set].pop() || null;
    app.anchor = anchor === undefined ? app.anchor : anchor;
  }
  // Drop selected wires that are gone, such as deleted ones or those another die took with it.
  function syncSel() {
    if (!app.selWires.size) return;
    const live = new Set(S.wires);
    if ([...app.selWires].every(w => live.has(w))) return;
    setSel(new Set([...app.selWires].filter(w => live.has(w))), primaryWire, live.has(app.anchor) ? app.anchor : null);
  }
  let plan, tilt;

  /* ---- feedback ---- */
  function toast(msg, kind) {
    const d = document.createElement('div');
    d.className = 'toast' + (kind ? ' ' + kind : '');
    d.textContent = msg;
    $('toasts').appendChild(d);
    setTimeout(() => d.remove(), kind === 'err' ? 9000 : 5200);
  }
  function busy(text, frac) {
    if (text === null) { $('busy').hidden = true; return; }
    $('busy').hidden = false;
    $('busyText').textContent = text;
    $('busyBar').style.width = frac === undefined ? '100%' : (frac * 100).toFixed(0) + '%';
  }
  const frame = () => new Promise(r => setTimeout(r, 0));
  function guarded(fn) { return async (...a) => { try { return await fn(...a); } catch (e) { console.error(e); toast(e.message || String(e), 'err'); busy(null); } }; }

  /* ---- derived state ---- */
  function indexDie() { S.padBy = new Map((S.die ? S.die.pads : []).map(p => [p.num, p])); }
  function indexLands() { S.landBy = new Map(S.lands.map(l => [l.id, l])); }
  function pruneWires() { S.wires = S.wires.filter(w => M.wireEnds(S, w)); }

  function refreshLands() {
    if (!S.substrate) { S.lands = []; S.paddle = null; S.drawn = []; indexLands(); return; }
    const b = S.substrate.board;
    const fps = S.substrate.selected >= 0 ? [b.fps[S.substrate.selected]] : b.fps.filter((f, i) => !S.dies.some(d => d.dieMode === 'footprint' && d.die && d.die.boardIndex === i));
    const r = K.landsFrom(fps, { maxLen: S.maxLand });
    S.lands = r.lands.filter(l => !S.landSkip.includes(l.id));
    S.paddle = r.paddle;
    S.landsSkipped = r.skipped;
    S.substrate.selectedRef = S.substrate.selected >= 0 ? b.fps[S.substrate.selected].ref : '';
    S.drawn = K.drawnLines(fps);
    indexLands();
  }

  function computeRegimes() {
    app.regimes = {};
    if (!S.die || !S.lands.length) return;
    for (const [k, R] of Object.entries(M.REGIMES)) {
      if (R.needs && !R.needs(S)) { app.regimes[k] = null; continue; }
      const wires = R.run(S);
      app.regimes[k] = { wires, m: M.measure(S, wires) };
    }
  }
  function applyRegime(key, opts) {
    opts = opts || {};
    if (!S.die || !S.lands.length) { S.wires = S.wires.filter(w => w.pinned || !M.wireTouchesDie(S, w, S.active)); pruneWires(); return; }
    const R = M.REGIMES[key];
    if (key !== 'manual' && (!R || (R.needs && !R.needs(S)))) return;
    // A regime replaces its own wires only. The board speaks for every die, and the others for the selected one.
    const all = key === 'board';
    if (all) for (const d of S.dies) d.regime = key; else S.regime = key;
    const kept = S.wires.filter(w => w.pinned || (!all && M.wireDieId(S, w) !== S.active));
    if (key === 'manual') S.wires = kept;
    else {
      // A pad already spoken for keeps its wire, whichever end of that wire it is.
      const taken = new Set();
      for (const w of kept) for (const k of M.wireEndKeys(S, w)) taken.add(k);
      S.wires = kept.concat(R.run(S).filter(w => !M.wireEndKeys(S, w).some(k => k.indexOf('land\t') !== 0 && taken.has(k))));
    }
    pruneWires();
    app.selWire = null; app.flagged = null; app.flagId = null;
  }
  // The regime worth showing first: one that pairs the most pads without crossings, the board's own wires when it has them.
  function pickRegime() {
    computeRegimes();
    if (app.regimes.board && app.regimes.board.m.wires) return 'board';
    const ok = k => app.regimes[k] && app.regimes[k].m.wires >= 0.8 * S.die.pads.length && !app.regimes[k].m.cross;
    if (ok('number')) return 'number';
    if (ok('nets')) return 'nets';
    return 'ring';
  }
  // A new substrate starts the wires again, for every die. A die added beside others starts by hand, unless its slot was already following a regime.
  function regenWires() {
    S.wires = [];
    const dies = placedDies();
    for (const d of dies) {
      if (d !== dies[0] && d.regime === 'manual') continue;
      if (S.lands.length) withDie(d, () => applyRegime(pickRegime()));
      if (d.regime === 'board') break;
    }
  }
  function placeDies() {
    if (S.substrate) for (const d of M.stackOrder(S)) if (!d.die.placed) withDie(d, () => { M.autoPlace(S); d.die.placed = true; });
  }
  // scope 'die': only the selected die's source changed, so only its wires go.
  function afterSources(scope) {
    indexDie(); refreshLands();
    placeDies();
    if (scope === 'die' && manyDies()) {
      S.wires = S.wires.filter(w => !M.wireTouchesDie(S, w, S.active));
      if (S.die && S.lands.length && S.regime !== 'manual') applyRegime(pickRegime());
    } else regenWires();
    pruneWires();
    renderAll();
    plan.fit();
    if (app.mode === '3d') tilt.fit();
    save();
  }

  /* ---- loading ---- */
  const extOf = name => { const n = name.toLowerCase(); if (n.endsWith('.gds.gz') || n.endsWith('.gds2.gz')) return 'gds.gz'; return n.split('.').pop(); };
  async function readGdsBuffer(file) {
    if (extOf(file.name) === 'gz' || extOf(file.name) === 'gds.gz') {
      if (!W.DecompressionStream) throw new Error('This browser can\'t decompress .gz files. Unzip it and drop the .gds.');
      return new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    }
    return file.arrayBuffer();
  }
  function setSubstrate(board, text, fileName) {
    const selected = board.kind === 'footprint' ? 0 : K.suggestSubstrate(board);
    S.substrate = { board, text, fileName, selected, kind: board.kind };
    V.buildBoardPaths(S.substrate);
    S.boardWires = board.kind === 'board' ? K.boardWires(board) : [];
    plan.vis = {};
    for (const n of S.substrate.layerNames) plan.vis[n] = !/CrtYd|Fab|Dwgs|Cmts/.test(n);
    const fromBoard = K.boardTypes(board);
    for (const t of fromBoard) {
      t.colour = t.colour || (S.types.find(o => o.name === t.name) || {}).colour || '#e8b84a';
      const i = S.types.findIndex(o => o.name === t.name);
      if (i >= 0) S.types[i] = Object.assign({}, S.types[i], t); else S.types.push(t);
    }
    if (fromBoard.length) toast(`Read ${fromBoard.length} wire types from the board.`);
    S.landSkip = [];
    S.existingDie = null;
    if (board.kind === 'board') {
      const d = board.fps.find(f => f.wbKind === 'die');
      if (d) {
        const die = K.dieFromFootprint(d), [a, b] = K.rot(...M.dieCentre(die), d.rot);
        S.existingDie = { x: d.x + a, y: d.y + b, rot: d.rot };
      }
    }
    for (const d of S.dies) if (d.die) d.die.placed = false;
  }
  const loadSubstrateText = (text, name) => {
    const low = name.toLowerCase();
    const board = low.endsWith('.kicad_mod') ? K.parseFootprintFile(text) : K.parseBoard(text);
    if (board.kind === 'footprint') board.fps[0].ref = board.fps[0].ref && !/REF/.test(board.fps[0].ref) ? board.fps[0].ref : 'J1';
    setSubstrate(board, text, name);
    return board;
  };
  async function artFromImages(die) {
    const im = die.images && die.images[0];
    if (!im) return;
    const img = new Image();
    await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = 'data:image/png;base64,' + im.b64; }).catch(() => null);
    if (!img.width) return;
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    die.artCanvas = c;
    delete die.images;
  }
  async function useFootprintDie(fp, fileName, opts) {
    opts = opts || {};
    const die = K.dieFromFootprint(fp);
    die.fileName = fileName;
    die.sourceText = opts.text || null;
    if (opts.boardIndex !== undefined) { die.boardIndex = opts.boardIndex; S.place = Object.assign({}, S.place, { x: fp.x, y: fp.y, rot: fp.rot }); die.placed = true; }
    await artFromImages(die);
    S.die = die; S.dieMode = 'footprint'; S.layers = null; gds.lib = null; gds.file = null; S.netOverride = {}; S.dieRemoved = [];
    S.existingDie = null;
    afterSources('die');
    toast(`Die from footprint: ${die.pads.length} pads.`);
  }
  function buildOptions() {
    const o = S.gdsOpts;
    let re = null;
    try { re = o.markText ? new RegExp(o.markText, 'i') : null; } catch (e) { /* a half-typed pattern finds no mark */ }
    return { padLayer: o.padLayer, minUm: o.minUm, maxUm: o.maxUm, peripheralOnly: o.peripheralOnly, corner: o.corner, dir: o.dir, markRe: re, firstKey: o.firstKey, removed: o.removed, labelLayer: o.labelLayer };
  }
  const ctlBusy = label => ({ onTick() { busy(label); } });
  function keepArt(next, prev) {
    if (prev && prev.artCanvas) { next.artCanvas = prev.artCanvas; next.artBlob = prev.artBlob; }
    next.fileName = (prev && prev.fileName) || (gds.file && gds.file.name);
  }
  async function rebuildGds() {
    const prev = S.die, ctl = ctlBusy('Reading pads');
    busy('Reading pads');
    await frame();
    const die = await G.buildDie(gds.lib, gds.top, Object.assign({ candidates: gds.cands }, buildOptions()), ctl);
    delete die.candidatesRaw;
    keepArt(die, prev);
    die.placed = prev ? prev.placed : false;
    applyNetOverrides(die);
    S.die = die;
    busy(null);
  }
  function applyNetOverrides(die) {
    for (const p of die.pads) if (S.netOverride[p.key] !== undefined) p.net = S.netOverride[p.key] || null;
    if (die.source === 'footprint' && S.dieRemoved.length) die.pads = die.pads.filter(p => !S.dieRemoved.includes(p.key));
  }
  async function selectCell(name) {
    const top = gds.lib.cells.get(name) || gds.lib.tops[0];
    gds.top = top;
    S.gdsOpts.cell = top.name;
    busy('Looking for pads');
    await frame();
    gds.cands = await G.padCandidates(gds.lib, top, buildOptions(), ctlBusy('Looking for pads'));
    if (!gds.cands.some(c => c.key === S.gdsOpts.padLayer)) S.gdsOpts.padLayer = gds.cands[0] ? gds.cands[0].key : null;
    S.layers = G.defaultLayers(gds.lib, top);
    S.die = null;
    await rebuildGds();
    S.die.placed = false;
  }
  async function renderArt() {
    if (!gds.lib || !S.die || !S.layers) return;
    const me = slot();
    if (me.artToken) me.artToken.cancelled = true;
    const die = S.die;
    const ctl = me.artToken = {
      onLayer(f, key, canvas) {
        if (ctl.cancelled) return;
        busy('Drawing ' + key, f);
        die.artCanvas = canvas;
        plan.draw(); tilt.draw();
      },
      onTick() { },
    };
    busy('Drawing artwork', 0);
    const t0 = performance.now();
    const canvas = await G.render(gds.lib, gds.top, S.layers, S.gdsOpts.artPx, ctl);
    if (ctl.cancelled || !canvas) return;
    me.artToken = null;
    die.artCanvas = canvas;
    die.artBlob = null;
    die.artMs = performance.now() - t0;
    busy(null);
    plan.draw(); tilt.draw();
    renderLeft();
    save();
  }
  const loadGds = guarded(async file => {
    if (/\.(oas|oasis)$/i.test(file.name)) throw new Error('OASIS isn\'t supported yet. Export the die as GDS first.');
    busy('Reading ' + file.name, 0);
    await frame();
    const buf = await readGdsBuffer(file);
    busy('Parsing GDS', 0);
    await frame();
    const t0 = performance.now();
    const lib = await G.parse(buf, f => busy('Parsing GDS', f));
    gds.lib = lib; gds.file = file;
    S.dieMode = 'gds';
    S.netOverride = {}; S.dieRemoved = [];
    Object.assign(S.gdsOpts, { firstKey: null, removed: [], padLayer: null, corner: 'auto' });
    await selectCell(lib.tops[0].name);
    S.die.fileName = file.name;
    afterSources('die');
    busy(null);
    const i = S.die.info;
    toast(`${file.name}: ${fx((S.die.x1 - S.die.x0))} × ${fx(S.die.y1 - S.die.y0)} mm, ${S.die.pads.length} pads on ${i.padLayer}, ${i.netsFound} named, in ${fx((performance.now() - t0) / 1000, 1)} s.`);
    guarded(renderArt)();
  });
  async function ensureGds() {
    if (gds.lib) return true;
    if (!gds.file) { toast('Drop the GDS again to change this. Only its result was saved.', 'warn'); return false; }
    busy('Reading ' + gds.file.name);
    const buf = await readGdsBuffer(gds.file);
    gds.lib = await G.parse(buf, f => busy('Parsing GDS', f));
    gds.top = gds.lib.cells.get(S.gdsOpts.cell) || gds.lib.tops[0];
    gds.cands = await G.padCandidates(gds.lib, gds.top, buildOptions(), ctlBusy('Looking for pads'));
    busy(null);
    return true;
  }
  const loadFiles = guarded(async (files, role) => {
    const list = [...files], mods = [], rest = [], side = [];
    for (const f of list) { const e = extOf(f.name); (e === 'kicad_mod' ? mods : e === 'kicad_pro' || e === 'kicad_sch' ? side : rest).push(f); }
    const fresh = {};
    for (const f of side) fresh[extOf(f.name) === 'kicad_pro' ? 'pro' : 'sch'] = await f.text();
    for (const f of rest) {
      const e = extOf(f.name);
      if (e === 'kicad_pcb') { S.sidecars = {}; loadSubstrateText(await f.text(), f.name); if (!S.die || S.dieMode !== 'gds') tryDieInBoard(); afterSources(); toast(`${f.name}: ${S.substrate.board.fps.length} footprints.`); }
      else if (['gds', 'gds2', 'gdsii', 'gz', 'gds.gz'].includes(e)) await loadGds(f);
      else if (['oas', 'oasis'].includes(e)) toast('OASIS isn\'t supported yet. Export the die as GDS first.', 'err');
      else toast(`${f.name} isn't a file this reads. It takes .kicad_pcb, .kicad_mod, .gds and .gds.gz.`, 'err');
    }
    if (side.length) {
      Object.assign(S.sidecars, fresh);
      if (!rest.length && !mods.length) { renderLeft(); save(); toast('Project files will travel with the exported board.'); }
    }
    if (!mods.length) return;
    const parsed = [];
    for (const f of mods) { const text = await f.text(); parsed.push({ f, text, board: K.parseFootprintFile(text) }); }
    const areaOf = p => { const d = K.dieFromFootprint(p.board.fps[0]); return (d.x1 - d.x0) * (d.y1 - d.y0); };
    const assign = async (p, as) => {
      if (as === 'die') await useFootprintDie(p.board.fps[0], p.f.name, { text: p.text });
      else { loadSubstrateText(p.text, p.f.name); afterSources(); toast(`${p.f.name} is the substrate: ${S.lands.length} lands.`); }
    };
    if (role) { for (const p of parsed) await assign(p, role); return; }
    if (parsed.length >= 2) {
      // Of two footprints, the die is the one that fits inside the other.
      parsed.sort((a, b) => areaOf(b) - areaOf(a));
      await assign(parsed[0], 'substrate');
      await assign(parsed[1], 'die');
    } else {
      const p = parsed[0], declared = p.board.fps[0].wbKind === 'die';
      await assign(p, declared || S.substrate ? 'die' : 'substrate');
    }
  });
  // Every die footprint in the board comes in as a die, named by its reference, because that's what its wires call it.
  function tryDieInBoard() {
    // In order of reference, because KiCad reorders footprints when it saves a board.
    const b = S.substrate.board, found = b.fps.map((f, i) => ({ f, i })).filter(x => x.f.wbKind === 'die')
      .sort((x, y) => String(x.f.ref).localeCompare(String(y.f.ref), undefined, { numeric: true }) || x.i - y.i);
    if (!found.length || placedDies().length) return;
    S.dies = S.dies.filter(d => d.die || d.id === S.active);
    found.forEach(({ f, i }, n) => {
      const die = K.dieFromFootprint(f);
      die.fileName = S.substrate.fileName; die.boardIndex = i; die.placed = true;
      // One die keeps the name D1 it always had. Several take their references, because their wires tell them apart by it.
      const ref = found.length > 1 && f.ref && !/REF/.test(f.ref) && !S.dies.some((d, k) => d.id === f.ref && (n === 0 ? k > 0 : true)) ? f.ref : null;
      let d;
      if (n === 0) { d = slot(); if (ref) { d.id = ref; S.active = ref; } }
      else { d = newSlot(ref || nextDieId(), 'board'); S.dies.push(d); }
      d.place = Object.assign({}, d.place, { x: f.x, y: f.y, rot: f.rot });
      d.die = die; d.dieMode = 'footprint';
      d.padBy = new Map(die.pads.map(p => [p.num, p]));
      if (f.props.wb_thickness_um) d.place.thick = +f.props.wb_thickness_um;
      if (f.props.wb_attach_um) d.place.attach = +f.props.wb_attach_um;
      if (f.props.wb_sits_on) { d.place.on = f.props.wb_sits_on; d.place.customUm = +f.props.wb_bottom_um || 0; }
      artFromImages(die).then(() => { plan.draw(); tilt.draw(); });
    });
    // A die that names something not in this board keeps the height the board recorded.
    for (const d of S.dies) if (d.place.on && d.place.on !== 'board' && d.place.on !== 'custom' && !M.dieById(S, d.place.on)) d.place.on = 'custom';
    S.existingDie = null;
  }
  async function loadSample(which) {
    const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
    const s = W.WBX.samples;
    if (!s) { toast('The examples aren\'t bundled in this copy. Run python app/make_samples.py.', 'err'); return; }
    await reset(true);
    if (which === 'gds') await loadFiles([new File([b64(s.board)], 'example.kicad_pcb'), new File([b64(s.gds)], 'example.gds')]);
    else await loadFiles([new File([b64(s.ring)], 'example_ring.kicad_mod'), new File([b64(s.dieMod)], 'example_die.kicad_mod')]);
  }

  /* ---- session: survives a reload, in this browser only ---- */
  const DB = 'wire-bond-bench', STORE = 'session';
  const openDb = () => new Promise((ok, bad) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error); });
  let saveTimer = null;
  function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveNow().catch(e => console.warn('session not saved', e)), 700); }
  async function saveNow() {
    const dies = [];
    for (const d of S.dies) {
      if (d.die && d.die.artCanvas && !d.die.artBlob) { const c = d.die.artCanvas; d.die.artBlob = await new Promise(r => c.toBlob(r, 'image/png')); }
      const die = d.die && Object.assign({}, d.die);
      if (die) delete die.artCanvas;
      dies.push({ id: d.id, die, gdsFile: d.gds.file, place: d.place, regime: d.regime, numberOffset: d.numberOffset, placeNote: d.placeNote, gdsOpts: d.gdsOpts, netOverride: d.netOverride, dieRemoved: d.dieRemoved, dieMode: d.dieMode, layers: d.layers });
    }
    const snap = { v: 2, substrate: S.substrate && { text: S.substrate.text, fileName: S.substrate.fileName, selected: S.substrate.selected }, dies, active: S.active, wires: S.wires, types: S.types, typeRules: S.typeRules, defaultType: S.defaultType, limits: Object.assign({}, S.limits), rules: S.rules, bond: S.bond, sidecars: S.sidecars, maxLand: S.maxLand, landSkip: S.landSkip };
    const db = await openDb();
    await new Promise((ok, bad) => { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(snap, 'current'); t.oncomplete = ok; t.onerror = () => bad(t.error); });
    db.close();
  }
  async function restore() {
    let snap = null;
    try {
      const db = await openDb();
      snap = await new Promise((ok, bad) => { const r = db.transaction(STORE).objectStore(STORE).get('current'); r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error); });
      db.close();
    } catch (e) { return false; }
    // A session saved before several die existed holds one die at the top level: it becomes the first slot, and its wires that die's.
    const saved = snap && (snap.dies || (snap.die || snap.substrate ? [Object.assign({ id: 'D1' }, snap)] : []));
    if (!snap || !(snap.substrate || saved.some(d => d.die))) return false;
    try {
      for (const k of ['types', 'typeRules', 'defaultType', 'limits', 'bond', 'sidecars', 'maxLand', 'landSkip']) if (snap[k] !== undefined) S[k] = snap[k];
      // A session from before the DRC rules has only limits, which the line above wrote into the rules. A newer one has the rules themselves.
      if (snap.rules) S.rules = DRC.normalise(snap.rules);
      S.dies = saved.map(o => {
        const d = newSlot(o.id);
        for (const k of ['die', 'regime', 'numberOffset', 'placeNote', 'netOverride', 'dieRemoved', 'dieMode', 'layers']) if (o[k] !== undefined) d[k] = o[k];
        if (o.place) d.place = Object.assign(d.place, o.place);
        if (o.gdsOpts) d.gdsOpts = o.gdsOpts;
        d.gds.file = o.gdsFile || null;
        return d;
      });
      S.active = snap.active && M.dieById(S, snap.active) ? snap.active : S.dies[0].id;
      if (snap.substrate) {
        const keepTypes = S.types;
        loadSubstrateText(snap.substrate.text, snap.substrate.fileName);
        S.types = keepTypes;
        S.landSkip = snap.landSkip || [];
        S.substrate.selected = snap.substrate.selected;
      }
      for (const d of S.dies) {
        if (!d.die) continue;
        d.die.placed = true;
        if (d.die.artBlob) {
          const bmp = await createImageBitmap(d.die.artBlob), c = document.createElement('canvas');
          c.width = bmp.width; c.height = bmp.height; c.getContext('2d').drawImage(bmp, 0, 0);
          d.die.artCanvas = c;
        }
        d.padBy = new Map(d.die.pads.map(p => [p.num, p]));
      }
      refreshLands();
      S.wires = snap.wires || [];
      for (const w of S.wires) if (w.die == null) w.die = S.dies[0].id;
      pruneWires();
      M.ensureUndefinedType(S);
      S.existingDie = null;
      return true;
    } catch (e) { console.warn('saved session unreadable', e); return false; }
  }
  async function reset(quiet) {
    for (const d of S.dies) if (d.artToken) d.artToken.cancelled = true;
    clearTimeout(saveTimer);
    const opts = Object.assign({}, S.gdsOpts, { cell: null, padLayer: null, firstKey: null, removed: [], corner: 'auto', dir: 'ccw' });
    Object.assign(S, { substrate: null, dies: [newSlot('D1')], active: 'D1', sidecars: {}, lands: [], paddle: null, wires: [], boardWires: [], drawn: [], types: M.DEFAULT_TYPES(), rules: DRC.defaults(), bond: { mode: 'inner', mm: 0.2 }, landSkip: [], existingDie: null, typeRules: [], defaultType: M.GENERIC });
    S.gdsOpts = opts;
    app.sel = app.selWire = app.flagged = app.flagId = app.preview = null;
    indexDie(); indexLands();
    try { const db = await openDb(); await new Promise(ok => { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).delete('current'); t.oncomplete = ok; t.onerror = ok; }); db.close(); } catch (e) { /* nothing saved */ }
    busy(null);
    plan.fitted = false;
    renderAll();
    plan.draw();
    if (!quiet) toast('Cleared.');
  }

  /* ---- left panel ---- */
  const fieldNum = (label, bind, value, step, extra) => `<label class="field"><span>${label}</span><input type="number" data-bind="${bind}" value="${esc(value)}" step="${step || 'any'}" ${extra || ''}></label>`;
  // A small ⓘ for a longer explanation, from js/tips.js. Clicking it only shows the tip.
  const info = (key, about) => `<span class="info" role="button" tabindex="0" data-tip="${esc(key)}" aria-label="About ${esc(about)}">ⓘ</span>`;
  function renderLeft() {
    const sub = S.substrate, die = S.die;
    let h = '';

    // 1 substrate
    h += `<section class="step ${sub ? 'done' : ''}"><h3><span class="num">1</span>Substrate<small>a footprint, or a board holding one</small></h3><div class="body">
      <button class="drop" data-act="pick" data-role="substrate" data-drop="substrate">${sub ? `<b>${esc(sub.fileName)}</b><small>Drop another to replace it</small>` : `<b>Drop a .kicad_pcb or .kicad_mod</b><small>or click to choose</small>`}</button>`;
    if (sub) {
      if (sub.kind === 'board') {
        const opts = sub.board.fps.map((f, i) => ({ f, i })).filter(({ f }) => !f.wbKind && f.pads.some(p => p.type === 'smd'));
        h += `<label class="field"><span>Use footprint</span><select data-bind="substrateFp"><option value="-1" ${sub.selected < 0 ? 'selected' : ''}>Whole board: every front SMD pad</option>${opts.map(({ f, i }) => `<option value="${i}" ${sub.selected === i ? 'selected' : ''}>${esc(f.ref)} ${esc(f.name)} (${f.pads.length})</option>`).join('')}</select></label>`;
      }
      const named = S.lands.filter(l => l.net).length;
      h += `<div class="stats"><div data-tip="stat:lands"><b>${S.lands.length}</b><span>lands</span></div><div data-tip="stat:landNets"><b>${named}</b><span>with nets</span></div><div data-tip="stat:paddle"><b>${S.paddle ? fx(S.paddle.w, 1) + '×' + fx(S.paddle.h, 1) : 'none'}</b><span>paddle, mm</span></div></div>`;
      h += `<details class="more"><summary>What counts as a land</summary>${fieldNum('Longest side', 'maxLand', S.maxLand, 0.1, 'min="0.1"')}<div class="note">SMD pads on front copper, up to this many mm long. The biggest pad over that is the paddle. ${S.landSkip.length ? `<button class="link" data-act="unskipLands">Bring back ${S.landSkip.length} skipped</button>` : ''}</div></details>`;
      if (!S.lands.length) h += `<div class="warnline">No lands here. Try another footprint, or the whole board.</div>`;
      if (sub.kind === 'board') h += `<div class="note">${S.sidecars.pro ? 'Project file loaded: its design rules travel with the export.' : 'Add the .kicad_pro to keep the design rules in the export.'}</div>`;
    }
    h += `</div></section>`;

    // 2 die
    h += `<section class="step ${die ? 'done' : ''}"><h3><span class="num">2</span>Die<small>from a GDS or a footprint</small></h3><div class="body">
      ${S.dies.length > 1 ? dieList() : ''}
      <div class="seg" style="margin-bottom:7px"><button data-act="dieMode" data-mode="gds" class="${S.dieMode === 'gds' ? 'on' : ''}">From GDS</button><button data-act="dieMode" data-mode="footprint" class="${S.dieMode === 'footprint' ? 'on' : ''}">From footprint</button></div>`;
    if (S.dieMode === 'gds') {
      const f = die && die.source === 'gds' ? die.fileName : null;
      h += `<button class="drop" data-act="pick" data-role="die-gds" data-drop="die-gds">${f ? `<b>${esc(f)}</b><small>Drop another to replace it</small>` : `<b>Drop a .gds or .gds.gz</b><small>or click to choose</small>`}</button>`;
      if (die && die.source === 'gds') h += renderGdsControls();
    } else {
      const f = die && die.source === 'footprint' ? die.fileName : null;
      h += `<button class="drop" data-act="pick" data-role="die" data-drop="die">${f ? `<b>${esc(f)}</b><small>Drop another to replace it</small>` : `<b>Drop a .kicad_mod</b><small>or click to choose</small>`}</button>`;
      if (sub && sub.kind === 'board') {
        const opts = sub.board.fps.map((x, i) => ({ x, i })).filter(({ x, i }) => i !== sub.selected && x.wbKind !== 'wire' && x.wbKind !== 'type_library' && (x.pads.length || x.wbKind === 'die'));
        h += `<label class="field"><span>Or from board</span><select data-bind="dieFromBoard"><option value="">Choose…</option>${opts.map(({ x, i }) => `<option value="${i}" ${die && die.boardIndex === i ? 'selected' : ''}>${esc(x.ref)} ${esc(x.name)}</option>`).join('')}</select></label>`;
      }
      if (die && die.source === 'footprint') {
        h += dieStats(die);
        for (const n of die.info.notes) h += `<div class="warnline">${esc(n)}</div>`;
        h += `<div class="note">Outline from ${esc(die.info.outlineFrom)}.</div>`;
      }
    }
    if (sub && die && die.source === 'footprint' && sub.kind === 'footprint' && S.dies.length === 1) h += `<div class="note"><button class="link" data-act="swapRoles">Swap die and substrate</button></div>`;
    if (die) h += `<div class="note"><button class="link" data-act="addDie">Add another die</button></div>`;
    h += `</div></section>`;

    // 3 placement
    if (die) {
      const P = S.place, many = manyDies();
      h += `<section class="step done"><h3><span class="num">3</span>Placement${many ? ` of ${esc(S.active)}` : ''}</h3><div class="body">
        <div class="duo">${fieldNum('X, mm', 'place.x', fx(P.x, 4))}${fieldNum('Y, mm', 'place.y', fx(P.y, 4))}</div>
        <label class="field"><span>Rotation</span><select data-bind="place.rot">${[0, 90, 180, 270].map(a => `<option value="${a}" ${P.rot === a ? 'selected' : ''}>${a}° on the board</option>`).join('')}${[0, 90, 180, 270].includes(P.rot) ? '' : `<option selected value="${P.rot}">${fx(P.rot, 1)}°</option>`}</select></label>
        ${bottomControls(many)}
        <div class="duo">${fieldNum('Die, µm', 'place.thick', P.thick, 5, 'min="1"')}${P.on === 'custom' ? '' : fieldNum('Attach, µm', 'place.attach', P.attach, 5, 'min="0"')}</div>
        <div class="note">${S.placeNote ? `Centred on <b>${esc(S.placeNote.from)}</b>. ` : ''}Thickness is assumed. <button class="link" data-act="autoPlace">Place again</button></div>
        ${S.placeNote && S.placeNote.lengths.some(l => l.mm) ? `<div class="note" data-tip="place:lengths">Total wire by rotation: ${S.placeNote.lengths.map(l => `${l.rot}° ${fx(l.mm, 0)}`).join(', ')} mm</div>` : ''}
        <details class="more" ${S.bond.mode !== 'inner' || S.bond.mm !== 0.2 ? 'open' : ''}><summary>Where a wire ends on a land</summary>
          <label class="field"><span>Second bond ${info('info:secondBond', 'the second bond')}</span><select data-bind="bond.mode"><option value="inner" ${S.bond.mode === 'inner' ? 'selected' : ''}>In from the inner end</option><option value="centre" ${S.bond.mode === 'centre' ? 'selected' : ''}>Land centre</option></select></label>
          ${S.bond.mode === 'inner' ? `<label class="field"><span>Distance</span><input type="range" min="0" max="1" step="0.01" data-live="bond.mm" value="${S.bond.mm}"></label><div class="note"><output id="bondOut" data-tip="bond:out">${fx(S.bond.mm)}</output> mm from the inner end. This is open question 8 in the plan.</div>` : ''}
        </details>
      </div></section>`;
    }
    $('left').innerHTML = h;
  }
  const sitsWords = d => d.place.on === 'custom' ? fx(M.dieBottom(S, d), 0) + ' µm' : M.dieSupport(S, d) ? 'on ' + d.place.on : 'on board';
  function dieList() {
    return `<div class="dielist" role="list">${S.dies.map(d => `<div class="dierow ${d.id === S.active ? 'on' : ''}" role="listitem" data-act="selectDie" data-id="${esc(d.id)}"><b>${esc(d.id)}</b><span${d.die ? ' data-tip="die:name"' : ''}>${d.die ? esc(d.die.name) : 'no file yet'}</span><small${d.die ? ' data-tip="die:sits"' : ''}>${d.die ? esc(sitsWords(d)) : ''}</small><button class="x" data-act="removeDie" data-id="${esc(d.id)}" aria-label="Remove ${esc(d.id)}">×</button></div>`).join('')}</div>`;
  }
  // Where the die's underside is. With one die it stays folded away unless someone has moved it off the board.
  function bottomControls(many) {
    const me = slot(), P = me.place, above = new Set(M.stackedOn(S, me).map(d => d.id));
    const others = placedDies().filter(d => d !== me && !above.has(d.id));
    const on = M.dieSupport(S, me) ? P.on : P.on === 'custom' ? 'custom' : 'board';
    const controls = `<label class="field"><span>Sits on ${info('info:sitsOn', 'Sits on')}</span><select data-bind="place.on"><option value="board" ${on === 'board' ? 'selected' : ''}>The board</option>${others.map(d => `<option value="${esc(d.id)}" ${on === d.id ? 'selected' : ''}>Top of ${esc(d.id)} (${esc(d.die.name)})</option>`).join('')}<option value="custom" ${on === 'custom' ? 'selected' : ''}>A custom height</option></select></label>
      ${on === 'custom' ? fieldNum('Underside, µm', 'place.customUm', fx(M.dieBottom(S, me), 1), 5, 'min="0"') : ''}
      <div class="note" id="dieHeights" data-tip="die:heights">Underside ${fx(M.dieBottom(S, me), 0)} µm, top ${fx(M.dieTop(S, me), 0)} µm above the board.${M.dieSupport(S, me) ? ` Follows ${esc(P.on)}.` : ''}</div>`;
    if (many || on !== 'board') return controls;
    return `<details class="more"><summary>Bottom of the die</summary>${controls}</details>`;
  }
  function dieStats(die) {
    const c = die.info.counts;
    return `<div class="stats"><div data-tip="stat:dieSize"><b>${fx(die.x1 - die.x0)}×${fx(die.y1 - die.y0)}</b><span>mm</span></div><div data-tip="stat:pads"><b>${die.pads.length}</b><span>pads</span></div><div data-tip="stat:named"><b>${die.pads.filter(p => p.net).length}</b><span>named</span></div></div>
      <div class="note mono" data-tip="stat:sides">bottom ${c.B}, right ${c.R}, top ${c.T}, left ${c.L}</div>`;
  }
  function renderGdsControls() {
    const die = S.die, o = S.gdsOpts, i = die.info;
    let h = dieStats(die);
    const cells = gds.lib ? gds.lib.choices : [{ name: o.cell }];
    h += `<label class="field"><span>Cell</span><select data-bind="gds.cell">${cells.slice(0, 60).map(c => `<option ${c.name === o.cell ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>`;
    h += `<label class="field"><span>Pad layer</span><select data-bind="gds.padLayer">${i.candidates.map(c => `<option value="${esc(c.key)}" ${c.key === i.padLayer ? 'selected' : ''}>${esc(c.key)}: ${c.modal === c.count ? c.count : c.modal + ' of ' + c.count} at ${esc(c.size)} µm</option>`).join('')}${i.candidates.length ? '' : '<option>none found</option>'}</select></label>`;
    const cornerText = { mark: `found <b>${esc(i.mark && i.mark.name)}</b>, ${i.corner}`, assumed: `no mark found, so <b>assumed ${i.corner}</b>`, labels: 'numbers read from the labels', set: `set to ${i.corner}` }[i.cornerSource];
    h += `<label class="field"><span>Pin 1 corner</span><select data-bind="gds.corner"><option value="auto" ${o.corner === 'auto' ? 'selected' : ''}>Auto</option>${['BL', 'BR', 'TR', 'TL'].map(k => `<option value="${k}" ${o.corner === k ? 'selected' : ''}>${{ BL: 'Bottom left', BR: 'Bottom right', TR: 'Top right', TL: 'Top left' }[k]}</option>`).join('')}</select></label>
      <label class="field"><span>Direction</span><select data-bind="gds.dir"><option value="ccw" ${o.dir === 'ccw' ? 'selected' : ''}>Counter-clockwise</option><option value="cw" ${o.dir === 'cw' ? 'selected' : ''}>Clockwise</option></select></label>
      <div class="note">Pin 1: ${cornerText}. ${o.firstKey ? `<button class="link" data-act="clearFirst">Pad 1 was set by hand; undo</button>` : 'Click a pad to set pad 1 by hand.'}</div>`;
    if (!die.pads.length) h += `<div class="warnline">No pads found. Try other size limits.</div>`;
    if (!i.netsFound) h += `<div class="note">No labels sit on the pads, so pads have numbers only. Wires still generate.</div>`;
    if (i.notes) for (const n of i.notes) h += `<div class="warnline">${esc(n)}</div>`;
    h += `<details class="more"><summary>How pads are found</summary>
      <div class="duo">${fieldNum('Min, µm', 'gds.minUm', o.minUm, 5, 'min="1"')}${fieldNum('Max, µm', 'gds.maxUm', o.maxUm, 5, 'min="1"')}</div>
      <label class="field wide" data-tip="bind:gds.peripheralOnly"><span><input type="checkbox" data-bind="gds.peripheralOnly" ${o.peripheralOnly ? 'checked' : ''}> Near the edge only (drops ${i.dropped.internal} internal)</span></label>
      <label class="field"><span>Pin 1 mark</span><input type="text" data-bind="gds.markText" value="${esc(o.markText)}"></label>
      ${o.removed.length ? `<div class="note"><button class="link" data-act="unremovePads">Bring back ${o.removed.length} removed pads</button></div>` : ''}
      <div class="note">Layers holding labels on pads: ${i.labelLayers.length ? esc(i.labelLayers.map(l => `${l.key} (${l.n})`).join(', ')) : 'none'}.</div>
    </details>`;
    if (S.layers) {
      h += `<details class="more"><summary>Artwork layers (${S.layers.filter(l => l.on).length} on)</summary>
        <label class="field"><span>Resolution</span><select data-bind="gds.artPx">${[1024, 2048, 4096, 8192].map(p => `<option value="${p}" ${o.artPx === p ? 'selected' : ''}>${p} px</option>`).join('')}</select></label>
        <div class="layerlist">${S.layers.map((L, k) => `<label data-tip="bind:layerOn"><input type="checkbox" data-bind="layerOn" data-k="${k}" ${L.on ? 'checked' : ''}><input type="color" data-bind="layerColour" data-k="${k}" value="${colourHex(L.colour)}" aria-label="Colour of ${esc(L.key)}"><span>${esc(L.key)}</span><small>${shortCount(L.count)}</small></label>`).join('')}</div>
        ${die.artMs ? `<div class="note">Drawn in ${fx(die.artMs / 1000, 1)} s.</div>` : ''}
      </details>`;
    }
    return h;
  }
  const shortCount = n => n >= 1e6 ? fx(n / 1e6, 1) + 'M' : n >= 1e3 ? fx(n / 1e3, 0) + 'k' : String(n);
  function colourHex(c) {
    if (c[0] === '#') return c;
    const t = document.createElement('canvas').getContext('2d');
    t.fillStyle = c;
    return t.fillStyle;
  }

  /* ---- right panel ---- */
  function renderRight() {
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === app.tab));
    app.checks = (S.die && S.wires.length) || manyDies() ? M.check(S) : null;
    if (app.checks && !app.checks.list.length) app.checks = null;
    const counts = { fail: 0, warn: 0 };
    if (app.checks) for (const c of app.checks.list) if (counts[c.status] !== undefined) counts[c.status]++;
    const cb = document.querySelector('#tabs [data-tab=checks]');
    cb.innerHTML = 'Checks' + (counts.fail ? `<span class="count bad">${counts.fail}</span>` : counts.warn ? `<span class="count warn">${counts.warn}</span>` : '');
    document.querySelector('#tabs [data-tab=wires]').innerHTML = 'Wires' + (S.wires.length ? `<span class="count">${S.wires.length}</span>` : '');
    const body = $('tabBody');
    const scroll = body.scrollTop, listFocused = !!document.activeElement && document.activeElement.matches('table.wires');
    body.innerHTML = { regimes: renderRegimes, checks: renderChecks, wires: renderWires, types: renderTypes }[app.tab]();
    body.scrollTop = scroll;
    // Keep keyboard focus on the wire list through a rebuild, so Ctrl+A and the arrows still reach it after a bulk edit.
    const list = listFocused && body.querySelector('table.wires');
    if (list) list.focus({ preventScroll: true });
    markPanel();
  }
  // Mark the selected wire in whichever tab is showing. Only classes change, so scroll and focus survive. Returns the first thing marked.
  function markPanel() {
    syncSel();
    const sel = app.selWires, body = $('tabBody');
    let first = null;
    const mark = (el, cls, on) => { el.classList.toggle(cls, on); if (on && !first) first = el; };
    if (app.tab === 'wires') body.querySelectorAll('tr[data-wire]').forEach(el => mark(el, 'on', sel.has(S.wires[+el.dataset.wire])));
    else if (app.tab === 'types') { const Ts = new Set([...sel].map(w => M.typeOf(S, w.type))); body.querySelectorAll('.type[data-type]').forEach(el => mark(el, 'on', Ts.has(S.types[+el.dataset.type]))); }
    else if (app.tab === 'checks') body.querySelectorAll('[data-check]').forEach(el => mark(el, 'hit', !!sel.size && app.checks.list.find(c => c.id === el.dataset.check).wires.some(w => sel.has(w))));
    return first;
  }
  // A wire picked in the 3D view shows up in the panel. Regimes has nothing per wire and Checks may not name this one, so those go to the Wires tab.
  function revealWire() {
    let el = markPanel();
    if (app.selWire && !el) { app.tab = 'wires'; renderRight(); el = markPanel(); }
    if (el) el.scrollIntoView({ block: 'nearest' });
  }
  // A regime covers the selected die, except the board's, which covers every die.
  function metricCells(m, die, all) {
    const miss = all ? placedDies().reduce((n, d) => n + d.die.pads.length, 0) - m.padsUsed : die.pads.length - (m.padsOn[S.active] || 0);
    return `<div class="metrics">
      <div data-tip="metric:wires"><b class="${miss ? 'warn' : ''}">${m.wires}</b>wires${miss > 0 ? `, ${miss} pads free` : ''}</div>
      <div data-tip="metric:total"><b>${m.estimate ? '≈' : ''}${fx(m.total, 1)}</b>total mm</div>
      <div data-tip="metric:longest"><b>${m.estimate ? '≈' : ''}${fx(m.longest)}</b>longest mm</div>
      <div data-tip="metric:cross"><b class="${m.cross ? 'bad' : ''}">${m.cross}</b>crossings</div>
      <div data-tip="metric:nets"><b class="${m.compared && m.agree < m.compared ? 'warn' : ''}">${m.compared ? m.agree + '/' + m.compared : 'n/a'}</b>nets agree</div>
    </div>`;
  }
  function renderRegimes() {
    if (!S.die || !S.lands.length) return `<p class="lead">Load a substrate and a die. Each way of pairing pads to lands is then measured here, so you can compare them on your own files.</p>`;
    let h = `<p class="lead">Each row is a different way to decide which pad goes to which land. Hover to see its wires dashed, and click to use it. Moving the die keeps the pairs and recalculates the geometry.</p>`;
    if (manyDies()) h += `<p class="note" id="regimeFor">For <b>${esc(S.active)}</b> and the lands, except From the board, which covers every die. Wires of the other die and pinned wires stay.</p>`;
    for (const [k, R] of Object.entries(M.REGIMES)) {
      const r = app.regimes[k];
      if (!r) { h += `<div class="regime off"><header><b>${R.label}</b>${info('info:regime:' + k, R.label)}<span class="tag na" data-tip="tag:noRead">nothing to read</span></header><p>${R.what}</p></div>`; continue; }
      h += `<div class="regime ${S.regime === k ? 'on' : ''}" data-regime="${k}" role="button" tabindex="0"><header><b>${R.label}</b>${info('info:regime:' + k, R.label)}${S.regime === k ? '<span class="tag ok" data-tip="tag:inUse">in use</span>' : ''}</header><p>${R.what}</p>${metricCells(r.m, S.die, k === 'board')}`;
      if (k === 'number') h += `<label class="field" style="margin-top:6px"><span>Offset</span><input type="number" step="1" data-bind="numberOffset" value="${S.numberOffset}"></label>`;
      h += `</div>`;
    }
    h += `<div class="regime ${S.regime === 'manual' ? 'on' : ''}" data-regime="manual" role="button" tabindex="0"><header><b>By hand</b>${info('info:regime:manual', 'By hand')}${S.regime === 'manual' ? '<span class="tag ok" data-tip="tag:inUse">in use</span>' : ''}</header><p>Clear the generated wires and add your own with the Wire tool (W). Hand-placed wires and ends you drag are pinned, and survive changing regime.</p></div>`;
    return h;
  }
  function renderChecks() {
    if (!app.checks) return `<p class="lead">Checks run once there are wires.</p>`;
    let h = `<p class="lead">Limits come from the DRC rules, each labelled by how solid its source is, because no bonding house has given us any. A placeholder only ever warns. Click a row to mark its wires.</p>
      <div class="tools"><button class="btn small" data-act="openDrc">DRC rules…</button></div>`;
    for (const c of app.checks.list) {
      const label = { ok: 'pass', warn: 'look', fail: 'problem', info: 'info', na: 'not checked', off: 'off' }[c.status] + (c.notChecked ? `, ${c.notChecked} not checked` : '');
      // A row with a rule shows the rule's value as a shortcut, and its tier, so a warning from a placeholder doesn't read as an established violation.
      const g = c.rule ? DRC.get(S, c.rule) : null;
      const limit = g ? (c.status === 'off' ? '' : `<span class="limit">limit <input type="number" data-bind="drc.value" data-rule="${g.id}" value="${g.value}" step="any"> ${esc(g.unit)}</span>`)
        : c.limitKey ? `<span class="limit">limit <input type="number" data-bind="limit.${c.limitKey}" value="${S.limits[c.limitKey]}" step="any"> ${c.unit}</span>` : '';
      const tier = g ? tierTag(g.tier) : '';
      h += `<div class="check ${app.flagId === c.id ? 'on' : ''}" data-check="${c.id}"><header><b data-tip="check">${esc(c.label)}</b>${tier}<span class="tag ${c.status}" data-tip="status">${label}</span></header>
        <span class="val" data-tip="check:value">${esc(c.value)}</span>${limit}
        <small>${esc(c.detail ? c.detail.replace(/\.?$/, '. ') : '')}Source: ${esc(c.source)}${g ? `, ${esc(DRC.TIERS[g.tier].label.toLowerCase())}${g.changed ? `; your value, default ${g.def} ${esc(g.unit)}` : ''}` : ''}.</small></div>`;
    }
    if (!S.limits.moldUm) h += `<div class="check"><header><b data-tip="rule:globTop">Glob top height</b><span class="tag na" data-tip="status">off</span></header><span class="limit" style="margin-left:0">top at <input type="number" data-bind="limit.moldUm" value="0" step="any"> µm, 0 for none</span></div>`;
    return h;
  }

  /* ---- DRC rules panel: every rule, its value and switch, and the tier and source of its default. It sits apart from placement. ---- */
  const tierTag = t => `<span class="tier ${esc(t)}" data-tip="tier">${esc(DRC.TIERS[t].label)}</span>`;
  function renderDrc() {
    const body = $('drcBody');
    if (!body) return;
    const byRule = new Map(((app.checks && app.checks.list) || []).filter(c => c.rule).map(c => [c.rule, c]));
    const counts = {};
    for (const r of DRC.TABLE) counts[r.tier] = (counts[r.tier] || 0) + 1;
    let h = `<header class="drchead"><h2 id="drcTitle">DRC rules</h2>${info('info:drcLevels', 'how rules are applied')}<div class="grow"></div>
        <button class="btn small" data-act="drcReset">Reset to defaults</button>
        <button class="btn small" data-act="drcExport">Export JSON</button>
        <button class="btn small" data-act="drcImport">Import JSON</button>
        <button class="btn small ghost" data-act="closeDrc">Close</button></header>
      <p class="lead">Optional, and saved with the session. Change a value to try yours, switch a rule off, or load someone else's file. Each default says how solid its source is: ${Object.keys(DRC.TIERS).map(t => `${tierTag(t)} ${counts[t] || 0}`).join(' ')}. A placeholder only ever warns. Every number is drawn and sourced in <a href="../docs/wire_bond_design_rules.svg" target="_blank" rel="noopener" data-tip="drc:sheet">the spec sheet</a>, and explained for newcomers in <a href="../docs/primer/wire-bonding-primer.html#rules" target="_blank" rel="noopener" data-tip="drc:primer">the primer</a>.</p>`;
    let group = null;
    for (const r of DRC.TABLE) {
      const g = DRC.get(S, r.id), c = byRule.get(r.id);
      if (r.group !== group) { group = r.group; h += `<h3>${esc(group)}</h3>`; }
      const status = r.enforce === 'no' ? `<span class="tag na" data-tip="tag:notEnforced">not enforced yet</span>`
        : !g.on ? '<span class="tag off" data-tip="status">off</span>'
        : c ? `<span class="tag ${c.status}" data-tip="status">${{ ok: 'pass', warn: 'look', fail: 'problem', info: 'info', na: 'not checked', off: 'off' }[c.status]}</span>` : '<span class="tag na" data-tip="tag:nothingToCheck">nothing to check</span>';
      const src = r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener" data-tip="drc:source">${esc(r.source)}</a>` : esc(r.source);
      h += `<div class="drcrule ${g.on ? '' : 'off'}" data-drc="${r.id}">
        <span class="key" data-tip="drc:key">${esc(r.key)}</span>
        <div class="main"><div class="top"><b>${esc(r.name)}</b>${tierTag(g.tier)}${status}</div>
          <div class="meaning">${esc(r.meaning)}</div>
          <div class="meta">${r.enforce === 'no' ? `Not enforced yet: ${esc(r.why)}` : `Applies to: ${esc(r.affects)}${r.enforce === 'specified' ? ' Not checked on wires left to the bonder.' : ''}`}</div>
          <div class="meta">Default ${esc(r.value)} ${esc(r.unit)}, ${esc(DRC.TIERS[r.tier].label.toLowerCase())}: ${esc(r.condition)} Source: ${src}.${g.fromFile ? ` <b>Your file: ${esc(g.source)}.</b>` : g.changed ? ' <b>Changed here.</b>' : ''}</div></div>
        <div class="ctl"><input type="number" step="any" data-bind="drc.value" data-rule="${r.id}" value="${esc(g.value)}" aria-label="${esc(r.name)}"><span class="unit">${esc(r.unit)}</span>
          <label data-tip="bind:drc.on"><input type="checkbox" data-bind="drc.on" data-rule="${r.id}" ${g.on ? 'checked' : ''}> on</label></div></div>`;
    }
    body.innerHTML = h;
  }
  function afterRules() { afterEdit(); renderDrc(); }
  function renderWires() {
    if (!S.wires.length) return `<p class="lead">No wires yet.</p>`;
    let h = `<div class="tools"><button class="btn small" data-act="reassign">Reassign types by rule</button><button class="btn small" data-act="unpinAll">Unpin all</button></div><table class="wires" tabindex="0" aria-multiselectable="true" data-tip="wires:table"><thead><tr><th data-tip="col:num">#</th><th data-tip="col:pad">Pad</th><th data-tip="col:to">${manyDies() ? 'To' : 'Land'}</th><th data-tip="col:net">Net</th><th data-tip="col:type">Type</th><th data-tip="col:mm">mm</th></tr></thead><tbody>`;
    S.wires.forEach((w, i) => {
      const e = M.wireEnds(S, w);
      if (!e) return;
      const net = e.pad.net || M.farNet(e) || '', ends = M.wireLabels(S, e);
      // The pinned dot and the ≈ explain themselves on hover; the text stays as it was.
      const len = fxLen(w, e.len).replace(/^≈/, '<span data-tip="wires:estimate">≈</span>');
      h += `<tr data-wire="${i}"><td>${i + 1}${w.pinned ? ' <span data-tip="wires:pinned">●</span>' : ''}</td><td>${esc(ends.from)}</td><td>${esc(ends.to)}</td><td class="net"${net ? ' data-tip="wires:net"' : ''}>${esc(net)}</td><td><select data-bind="wireType" data-i="${i}">${typeOptions(w.type, true)}</select></td><td>${len}</td></tr>`;
    });
    const open = S.wires.some(w => M.isBonderChoiceWire(S, w)) ? `<p class="note">Generic: chosen to leave the wire and loop to the bonder. Undefined: nobody has said. ≈ is the straight distance from pad to land, as an estimate.</p>` : '';
    return h + `</tbody></table><p class="note">● pinned: placed or edited by hand, so it survives changing regime.</p><p class="note">Ctrl+click a row to add or remove it, Shift+click for a range, Ctrl+A for all, then change them together on the right.</p>${open}`;
  }
  function loopSvg(t) {
    const spans = S.wires.map(w => { const e = M.wireEnds(S, w); return e ? e.len * 1000 : 0; }).filter(Boolean).sort((a, b) => a - b);
    const span = spans.length ? spans[spans.length >> 1] : 1500, zTop = M.dieTop(S, slot());
    if (!M.parseMoves(t.moves, span)) return `<svg viewBox="0 0 300 64" aria-hidden="true" data-tip="type:loop"><text x="150" y="36" text-anchor="middle" fill="#ff6b6b" font-size="11">Can't read these moves</text></svg>`;
    const rev = t.dir === 'reverse', curve = M.loopCurve(t, span, rev ? zTop : -zTop).map(p => [rev ? span - p[0] : p[0], p[1] + (rev ? 0 : zTop)]);
    const maxZ = Math.max(zTop, ...curve.map(p => p[1])) * 1.1, sx = 280 / span, sz = 54 / maxZ;
    const x = v => 10 + v * sx, z = v => 60 - v * sz;
    const dieEnd = Math.min(span * 0.08, 150);
    return `<svg viewBox="0 0 300 64" preserveAspectRatio="none" role="img" aria-label="Loop shape of ${esc(t.name)}" data-tip="type:loop"><rect x="0" y="${z(zTop)}" width="${x(dieEnd)}" height="${60 - z(zTop)}" fill="#2b3a37"/><line x1="0" x2="300" y1="60" y2="60" stroke="#4e7971"/><polyline fill="none" stroke="${esc(t.colour || '#e8b84a')}" stroke-width="1.6" vector-effect="non-scaling-stroke" points="${curve.map(p => fx(x(p[0]), 1) + ',' + fx(z(p[1]), 1)).join(' ')}"/></svg>`;
  }
  function renderTypes() {
    let h = `<p class="lead">A wire type works like a pad type: a family and a few sizes, with custom moves as the escape hatch. One type fits any span. Below it, rules pick a type from a net name.</p>
      <p class="note" id="defaultNote">New wires get <b>${esc(M.typeLabel(S.defaultType))}</b>${S.typeRules.some(r => r.match) ? ', unless a rule below matches' : ''}. Change it under Rules.</p>
      <div class="tools"><button class="btn small" data-act="addType">Add a type</button><button class="btn small" data-act="reassign">Reassign wires by rule</button></div>`;
    S.types.forEach((t, i) => {
      const used = S.wires.filter(w => w.type === t.name).length;
      const defaultTag = t.name === S.defaultType ? '<span class="tag info" data-tip="tag:default">default</span> ' : '';
      if (M.isBonderChoice(t)) {
        const gen = M.isGenericType(t);
        const say = gen ? 'A decision: this pad goes to this land, and the person at the machine picks the wire and loop. Drawn solid along a plain arc that stands in for any loop. Lengths are estimates.'
          : 'Nobody has said anything about this wire beyond its pad and land, as on a board whose wires name no type. Drawn dashed along the same stand-in arc as Generic. Lengths are estimates.';
        h += `<div class="type" data-type="${i}" data-tip="${gen ? 'type:generic' : 'type:undefined'}"><div class="head"><span style="width:16px;height:0;border-top:2px ${gen ? 'solid' : 'dashed'} ${esc(t.colour)}" aria-hidden="true"></span><b>${esc(M.typeLabel(t.name))}</b><small>${defaultTag}<span data-tip="type:used">${used} wires</span></small></div>
          <p class="note">${say}</p></div>`;
        return;
      }
      h += `<div class="type" data-type="${i}"><div class="head"><input type="color" data-bind="type.colour" data-i="${i}" value="${colourHex(t.colour || '#e8b84a')}" aria-label="Colour"><input type="text" data-bind="type.name" data-i="${i}" value="${esc(t.name)}" aria-label="Name"><small>${defaultTag}<span data-tip="type:used">${used} wires</span> <button class="x" data-act="delType" data-i="${i}" aria-label="Delete">×</button></small></div>
        ${loopSvg(t)}
        <div class="grid">
          <label class="span2">Family<select data-bind="type.family" data-i="${i}">${Object.entries(M.FAMILIES).map(([k, f]) => `<option value="${k}" ${t.family === k ? 'selected' : ''}>${f.label}</option>`).join('')}</select></label>
          <label>Wire, µm<input type="number" data-bind="type.d" data-i="${i}" value="${t.d}" min="1" step="1"></label>
          <label>Metal<select data-bind="type.material" data-i="${i}">${['Au', 'Al', 'Cu', 'Ag'].map(m => `<option ${t.material === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
          <label class="span2">Bond<select data-bind="type.style" data-i="${i}">${['ball-wedge', 'wedge-wedge'].map(m => `<option ${t.style === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
          <label class="span2">First bond ${info('info:firstBond', 'First bond')}<select data-bind="type.dir" data-i="${i}"><option value="forward" ${t.dir === 'forward' ? 'selected' : ''}>on the die</option><option value="reverse" ${t.dir === 'reverse' ? 'selected' : ''}>on the land</option></select></label>
          ${t.family && t.family !== 'custom' ? `<label class="span2">Loop height, µm<input type="range" min="40" max="600" step="5" data-live="type.h" data-i="${i}" value="${t.h || 200}"></label><label class="span2">Top run, %<input type="range" min="0" max="60" step="1" data-live="type.p" data-i="${i}" value="${t.p === undefined ? 15 : t.p}"></label>` : ''}
          <label class="span4">Moves<input type="text" class="moves" data-bind="type.moves" data-i="${i}" value="${esc(t.moves)}"></label>
        </div></div>`;
    });
    h += `<h4 style="margin:12px 0 2px;color:var(--ink-high);font-size:13px">Rules</h4><p class="note" style="margin-top:0">First match wins. Patterns are regular expressions on the net name.</p>`;
    S.typeRules.forEach((r, i) => {
      h += `<div class="rule"><input type="text" data-bind="rule.match" data-i="${i}" value="${esc(r.match)}" aria-label="Net pattern"><select data-bind="rule.type" data-i="${i}">${typeOptions(r.type)}</select><button class="x" data-act="delRule" data-i="${i}" aria-label="Delete rule">×</button></div>`;
    });
    h += `<div class="rule"><input type="text" value="anything else" disabled aria-label="Default" data-tip="rule:else"><select data-bind="defaultType">${typeOptions(S.defaultType)}</select><button class="x" data-act="addRule" aria-label="Add rule">+</button></div>`;
    return h;
  }

  /* ---- inspector and loop ---- */
  // Several wires at once: each control sets every selected wire, and shows "mixed" where they differ.
  function renderBulk(el, ws) {
    const n = ws.length, types = new Set(ws.map(w => w.type)), one = types.size === 1 ? ws[0].type : null;
    const pinned = ws.filter(w => w.pinned).length, moved = ws.filter(w => w.padOff || w.landOff || w.toPadOff).length;
    el.innerHTML = `<h4>${n} wires selected</h4>
      <label class="field"><span>Type</span><select data-bind="selType">${one === null ? `<option value="" selected disabled>Mixed: ${types.size} types</option>` : ''}${typeOptions(one)}</select></label>
      <label class="bulkpin" data-tip="bind:bulkPin"><input type="checkbox" data-bind="bulkPin" ${pinned === n ? 'checked' : ''}> Pinned${pinned && pinned < n ? ` <small>mixed, ${pinned} of ${n}</small>` : ''}</label>
      <div class="acts" style="margin-top:7px"><button class="btn small" data-act="delWire">Delete ${n}</button>${moved ? `<button class="btn small" data-act="resetEnds">Reset ends${moved < n ? ` (${moved})` : ''}</button>` : ''}</div>
      <p class="note">Changes apply to every selected wire. Ctrl+click adds or removes one, Shift+click a range, Esc clears.</p>`;
    el.querySelector('[data-bind=bulkPin]').indeterminate = pinned > 0 && pinned < n;
  }
  function renderInspector() {
    const el = $('inspector');
    syncSel();
    const w = app.selWire, sel = app.sel;
    if (app.selWires.size > 1) { renderBulk(el, [...app.selWires]); return; }
    if (w) {
      const e = M.wireEnds(S, w);
      if (!e) { el.innerHTML = ''; return; }
      const a = M.padAngle(S, e), agree = M.endsAgree(e), ends = M.wireLabels(S, e);
      el.innerHTML = `<h4>Wire W${String(S.wires.indexOf(w) + 1).padStart(2, '0')}${w.pinned ? ' <span class="tag info" data-tip="tag:pinned">pinned</span>' : ''}</h4>
        <dl><dt data-tip="insp:from">From</dt><dd>${esc(ends.fromWords)} ${esc(e.pad.net || '')}</dd><dt data-tip="insp:to">To</dt><dd>${esc(ends.toWords)} ${esc(M.farNet(e) || '')}</dd><dt data-tip="insp:length">Length</dt><dd>${fxLen(w, e.len)} mm</dd><dt data-tip="insp:angle">Angle</dt><dd>${fx(a, 1)}° off normal</dd><dt data-tip="insp:nets">Nets</dt><dd>${agree === null ? 'not comparable' : agree ? 'agree' : 'disagree'}</dd></dl>
        <label class="field"><span>Type</span><select data-bind="selType">${typeOptions(w.type)}</select></label>
        <div class="acts" style="margin-top:7px"><button class="btn small" data-act="delWire">Delete</button>${w.padOff || w.landOff || w.toPadOff ? '<button class="btn small" data-act="resetEnds">Reset ends</button>' : ''}<button class="btn small" data-act="togglePin">${w.pinned ? 'Unpin' : 'Pin'}</button></div>
        <p class="note">Drag the white squares to move an end.</p>`;
      return;
    }
    if (sel && sel[0] === 'p') {
      const p = selectedPad();
      if (p) {
        const n = M.wiresOnPad(S, S.active, p.num).length;
        el.innerHTML = `<h4>${manyDies() ? esc(S.active) + ' pad' : 'Die pad'} ${esc(p.num)}</h4><dl><dt data-tip="insp:padSize">Size</dt><dd>${fx(p.w * 1000, 1)} × ${fx(p.h * 1000, 1)} µm</dd><dt data-tip="insp:edge">Edge</dt><dd>${{ B: 'bottom', R: 'right', T: 'top', L: 'left' }[p.side]}</dd><dt data-tip="insp:padWires">Wires</dt><dd>${n}</dd></dl>
          <label class="field"><span>Net</span><input type="text" data-bind="padNet" value="${esc(p.net || '')}" placeholder="none"></label>
          <div class="acts" style="margin-top:7px">${S.die.source === 'gds' ? '<button class="btn small" data-act="makeFirst">Make this pad 1</button>' : ''}<button class="btn small" data-act="removePad">Not a pad</button></div>`;
        return;
      }
    }
    if (sel && sel[0] === 'l') {
      const l = S.landBy.get(sel.slice(1));
      if (l) {
        const n = S.wires.filter(x => x.land === l.id).length;
        el.innerHTML = `<h4>Land ${esc(l.id)}</h4><dl><dt data-tip="insp:landNet">Net</dt><dd>${esc(l.net || 'none')}</dd><dt data-tip="insp:landSize">Size</dt><dd>${fx(l.w)} × ${fx(l.h)} mm</dd><dt data-tip="insp:footprint">Footprint</dt><dd>${esc(l.ref)}</dd><dt data-tip="insp:landWires">Wires</dt><dd>${n}</dd></dl>
          <div class="acts"><button class="btn small" data-act="skipLand">Not a land</button></div>`;
        return;
      }
    }
    el.innerHTML = `<h4>Nothing selected</h4><p class="note" style="margin-top:0">Click a pad, a land or a wire. With the Wire tool, click a pad and then a land${manyDies() ? ', or a pad on another die,' : ''} to add one.</p>`;
  }
  // The pad in app.sel, which is always on the selected die: picking a pad selects its die.
  function selectedPad() {
    const sel = app.sel;
    if (!sel || sel[0] !== 'p') return null;
    const k = sel.indexOf('\t');
    return sel.slice(1, k) === S.active ? S.padBy.get(sel.slice(k + 1)) : null;
  }
  function currentLoopWire() {
    if (app.selWire && M.wireEnds(S, app.selWire)) return app.selWire;
    let best = null, d = -1;
    for (const w of S.wires) { const e = M.wireEnds(S, w); if (e && e.len > d) { d = e.len; best = w; } }
    return best;
  }
  function renderLoop() {
    const w = currentLoopWire();
    V.drawLoop($('loop'), S, w, w && M.wireEnds(S, w));
  }
  function renderShow() {
    const sub = S.substrate;
    let h = `<h5>In the plan</h5>` + [['art', 'Die artwork'], ['labels', 'Numbers on pads and lands'], ['wires', 'Wires'], ['board', 'Board']].map(([k, t]) => `<label data-tip="bind:show:${k}"><input type="checkbox" data-bind="show" data-k="${k}" ${plan.show[k] ? 'checked' : ''}> ${t}</label>`).join('');
    if (sub && sub.layerNames.length) h += `<h5>Board layers</h5>` + sub.layerNames.map(n => `<label data-tip="bind:layerVis"><input type="checkbox" data-bind="layerVis" data-k="${esc(n)}" ${plan.vis[n] !== false ? 'checked' : ''}> ${esc(n === '*' ? 'Vias' : n)}</label>`).join('');
    $('showMenu').innerHTML = h;
  }
  function renderEmpty() {
    const none = !S.substrate && !placedDies().length;
    $('empty').hidden = !none;
    if (!none) return;
    $('empty').innerHTML = `<div class="welcome"><h1>Marry a die to a substrate</h1>
      <p>Bring what you have. Nothing leaves this browser, and each part works with partial data.</p>
      <div class="flow"><div><b>1. Substrate</b><span>A KiCad footprint is the base. A whole board works too, and you pick the footprint in it.</span><span class="ext">.kicad_mod .kicad_pcb</span></div>
      <div><b>2. Die</b><span>From a GDS, which gives artwork, size, pads and any net names. Or just a second footprint.</span><span class="ext">.gds .gds.gz .kicad_mod</span></div>
      <div><b>3. Wires</b><span>Try each way of pairing them, compare the numbers, adjust by hand, then send it to KiCad.</span><span class="ext">.kicad_pcb .kicad_mod .csv</span></div></div>
      <div class="row"><button class="btn primary" data-act="pick" data-role="">Choose files</button><button class="btn" data-act="sample" data-sample="gds">Try a GDS on a board</button><button class="btn" data-act="sample" data-sample="mods">Try two footprints</button><small>or drop files anywhere</small></div></div>`;
  }
  function renderAll() {
    computeRegimes();
    renderLeft(); renderRight(); renderInspector(); renderLoop(); renderShow(); renderEmpty();
    $('exportBtn').disabled = !placedDies().length;
    plan.draw(); tilt.draw();
  }

  /* ---- events from the plan view ---- */
  app.hideTip = () => { $('tip').hidden = true; };
  app.showTip = (h, x, y) => {
    const tip = $('tip');
    let t = '';
    if (h && h.kind === 'pad') t = `<b>${manyDies() ? esc(h.slot.id) + ' pad' : 'Pad'} ${esc(h.pad.num)}</b> ${esc(h.pad.net || '')}<small>${fx(h.pad.w * 1000, 0)} × ${fx(h.pad.h * 1000, 0)} µm, ${M.wiresOnPad(S, h.slot.id, h.pad.num).length} wires</small>`;
    else if (h && h.kind === 'land') t = `<b>Land ${esc(h.land.id)}</b> ${esc(h.land.net || '')}<small>${fx(h.land.w)} × ${fx(h.land.h)} mm</small>`;
    else if (h && h.kind === 'wire') { const e = M.wireEnds(S, h.w), ends = M.wireLabels(S, e); t = `<b>W${String(S.wires.indexOf(h.w) + 1).padStart(2, '0')}</b> ${esc(M.typeLabel(h.w.type))}<small>${esc(ends.fromWords)} to ${esc(ends.toWords)}, ${fxLen(h.w, e.len)} mm</small>`; }
    if (!t) { tip.hidden = true; return; }
    tip.innerHTML = t; tip.hidden = false;
    tip.style.left = Math.min(x + 14, W.innerWidth - 310) + 'px'; tip.style.top = y + 14 + 'px';
  };
  app.status = (x, y) => { $('coord').textContent = `${fx(x, 3)}, ${fx(y, 3)} mm`; };
  let liveFrame = null;
  app.onGeometry = live => {
    plan.draw(); tilt.draw(); renderLoop();
    if (live) {
      if (liveFrame) return;
      liveFrame = requestAnimationFrame(() => { liveFrame = null; if (app.tab === 'checks') renderRight(); renderInspector(); });
    } else { computeRegimes(); renderLeft(); renderRight(); renderInspector(); save(); }
  };
  app.onClick = (h, ev) => {
    // Ctrl+click on a wire, in either view, adds it to the selection or takes it out, as in the Wires list. A plain click selects it alone.
    if (ev && (ev.ctrlKey || ev.metaKey) && h && h.kind === 'wire') {
      toggleWire(h.w); app.sel = null; selChanged();
      if (app.mode === '3d') revealWire();
      return;
    }
    if (plan.tool === 'wire' && app.mode === 'plan') {
      if (!h || (h.kind !== 'pad' && h.kind !== 'land')) { plan.rubber = null; plan.draw(); return; }
      const R = plan.rubber;
      // A pad to a land, or a pad to a pad on another die. Which end is clicked first says nothing about which is bonded first.
      const toLand = R && R.kind !== h.kind, toPad = R && h.kind === 'pad' && R.kind === 'pad' && R.slot !== h.slot;
      if (toLand || toPad) {
        let w;
        if (toPad) w = M.mkDieWire(S, R.slot.id, R.pad, h.slot.id, h.pad, { pinned: true });
        else {
          const from = h.kind === 'pad' ? h : R, land = h.kind === 'land' ? h.land : R.land;
          w = { die: from.slot.id, pad: from.pad.num, land: land.id, type: M.typeFor(S, from.pad.net || land.net), pinned: true };
        }
        S.wires.push(w);
        plan.rubber = null;
        app.selWire = w; app.sel = null;
        computeRegimes(); renderRight(); renderInspector(); renderLoop(); plan.draw(); save();
        return;
      }
      const at = h.kind === 'pad' ? M.dieToBoard(h.slot.place, h.pad.x, h.pad.y) : [h.land.x, h.land.y];
      plan.rubber = { kind: h.kind, pad: h.pad, land: h.land, slot: h.slot, at };
      plan.draw();
      return;
    }
    app.selWire = null; app.sel = null;
    // Picking a pad or a die's body selects that die, so the panels can act on it. With one die, that changes nothing.
    if (h && h.slot && h.slot.id !== S.active) selectDie(h.slot.id);
    if (h && h.kind === 'wire') app.selWire = h.w;
    else if (h && h.kind === 'pad') app.sel = 'p' + M.padKey(h.slot.id, h.pad.num);
    else if (h && h.kind === 'land') app.sel = 'l' + h.land.id;
    renderInspector(); renderLoop(); plan.draw(); tilt.draw();
    if (app.mode === '3d') revealWire(); else markPanel();
  };
  /* ---- selecting several wires, the way a desktop list does ---- */
  function selChanged() { renderInspector(); renderLoop(); plan.draw(); tilt.draw(); markPanel(); }
  function toggleWire(w) {
    const set = new Set(app.selWires);
    if (set.has(w)) set.delete(w); else set.add(w);
    setSel(set, set.has(w) ? w : primaryWire, w);
  }
  // The wires in the order the Wires table shows them, or in list order when it isn't showing.
  function listedWires() {
    const rows = app.tab === 'wires' ? [...$('tabBody').querySelectorAll('tr[data-wire]')] : [];
    return rows.length ? rows.map(r => S.wires[+r.dataset.wire]) : S.wires.filter(w => M.wireEnds(S, w));
  }
  // A click on a row: plain selects it alone, Ctrl toggles it, Shift selects from the anchor to it, and Ctrl+Shift adds that range.
  function pickRow(w, ev) {
    const ctrl = ev.ctrlKey || ev.metaKey, rows = listedWires();
    if (ev.shiftKey && app.anchor && rows.includes(app.anchor)) {
      const a = rows.indexOf(app.anchor), b = rows.indexOf(w);
      const set = ctrl ? new Set(app.selWires) : new Set();
      for (const x of rows.slice(Math.min(a, b), Math.max(a, b) + 1)) set.add(x);
      setSel(set, w);
    } else if (ctrl) toggleWire(w);
    else app.selWire = w;
    app.sel = null;
  }
  // Up and Down move through the list, and with Shift stretch the range from the anchor.
  function stepRow(dir, shift) {
    const rows = listedWires();
    if (!rows.length) return;
    const at = rows.indexOf(app.selWire), next = rows[at < 0 ? (dir > 0 ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, at + dir))];
    if (shift && app.anchor && rows.includes(app.anchor)) pickRow(next, { shiftKey: true });
    else app.selWire = next;
    app.sel = null;
    selChanged();
    const tr = $('tabBody').querySelector(`tr[data-wire="${S.wires.indexOf(next)}"]`);
    if (tr) tr.scrollIntoView({ block: 'nearest' });
  }
  function selectAllWires() { const rows = listedWires(); setSel(new Set(rows), app.selWire || rows[0], app.anchor || rows[0]); app.sel = null; selChanged(); }
  function selectDie(id) {
    if (id === S.active || !M.dieById(S, id)) return;
    S.active = id;
    app.sel = null;
    computeRegimes(); renderLeft(); renderRight(); renderInspector(); plan.draw(); tilt.draw(); save();
  }
  app.selectDie = selectDie;
  // Change the selected die's placement. Whatever sits on it goes with it.
  app.setPlace = changes => {
    const was = Object.assign({}, S.place);
    Object.assign(S.place, changes);
    carryStack(slot(), was);
  };

  /* ---- actions ---- */
  function rotateDie(deg) {
    const [cx, cy] = M.dieToBoard(S.place, ...M.dieCentre(S.die));
    const rot = ((deg % 360) + 360) % 360, [ax, ay] = K.rot(...M.dieCentre(S.die), rot);
    app.setPlace({ rot, x: cx - ax, y: cy - ay });
  }
  function download(name, content, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: type || 'text/plain' });
    const url = URL.createObjectURL(blob), a = $('dl');
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function manifest(slotD) {
    const d = slotD.die, P = slotD.place;
    const stack = manyDies() ? { id: slotD.id, sits_on: M.dieSupport(S, slotD) ? P.on : P.on === 'custom' ? 'custom' : 'board', bottom_um: M.dieBottom(S, slotD) } : {};
    return JSON.stringify(Object.assign({ name: d.name, source: d.source, file: d.fileName, w_mm: d.x1 - d.x0, h_mm: d.y1 - d.y0, thickness_um_assumed: P.thick, attach_um_assumed: P.attach }, stack, { pad_layer: d.info.padLayer || null, pin1: d.info.cornerSource ? { corner: d.info.corner, source: d.info.cornerSource, direction: d.info.dir } : null, pads: d.pads.map(p => ({ num: p.num, net: p.net, side: p.side, x_mm: +p.x.toFixed(6), y_mm: +p.y.toFixed(6), w_um: +(p.w * 1000).toFixed(3), h_um: +(p.h * 1000).toFixed(3) })) }), null, 1);
  }
  // A file name for each die: its own name, unless two die share one.
  function dieFileNames() {
    const dies = placedDies(), names = new Map();
    const count = n => dies.filter(d => X.safe(d.die.name) === n).length;
    for (const d of dies) { const n = X.safe(d.die.name); names.set(d, count(n) > 1 ? `${n}_${X.safe(d.id)}` : n); }
    return names;
  }
  const exporters = {
    fp() {
      const dies = placedDies(), names = dieFileNames();
      if (dies.length === 1) {
        const name = names.get(dies[0]);
        download(name + '.kicad_mod', X.dieFootprintFile(dies[0].die));
        toast(`Wrote ${name}.kicad_mod, with ${dies[0].die.pads.length} numbered pads. Add it to a footprint library.`);
        return;
      }
      const files = {};
      for (const d of dies) files[`wbx_die.pretty/${names.get(d)}.kicad_mod`] = X.dieFootprintFile(d.die, { name: names.get(d) });
      download('wbx_die_footprints.zip', X.zip(files));
      toast(`Wrote ${dies.length} die footprints in wbx_die.pretty. Add it as a footprint library.`);
    },
    kit() {
      const dies = placedDies(), names = dieFileNames(), lib = 'wbx_die.pretty', files = {};
      for (const d of dies) {
        const name = names.get(d);
        files[`${lib}/${name}.kicad_mod`] = X.dieFootprintFile(d.die, { model: `\${KIPRJMOD}/${name}.wrl`, name: dies.length > 1 ? name : undefined });
        files[`${name}.kicad_sym`] = X.symbolFile(d.die);
        files[`${name}.wrl`] = X.dieWrl(d.die, d.place.thick, d.place.attach);
        files[`${name}.die.json`] = manifest(d);
      }
      download((dies.length > 1 ? 'wbx_die' : names.get(dies[0])) + '_kit.zip', X.zip(files));
      toast(dies.length > 1 ? `Wrote the die kit for ${dies.length} die. Thickness in the 3D models is assumed.` : `Wrote the die kit for ${names.get(dies[0])}. Thickness in the 3D model is assumed.`);
    },
    board() {
      if (!S.substrate) { toast('Load a substrate first. A board needs something to sit on.', 'err'); return; }
      const r = X.assemble(S);
      const base = X.safe(S.substrate.fileName.replace(/\.[^.]+$/, '')) + '_bonded';
      const files = {};
      for (const [k, v] of Object.entries(r.files)) files[k === 'assembly.kicad_pcb' ? base + '.kicad_pcb' : k] = v;
      if (S.sidecars.pro) files[base + '.kicad_pro'] = S.sidecars.pro;
      if (S.sidecars.sch) files[base + '.kicad_sch'] = S.sidecars.sch;
      download(base + '.zip', X.zip(files));
      toast(`Wrote ${base}.zip: ${r.rows.length} wires on ${r.layer}. Unzip it and open the .kicad_pcb.`);
      if (S.substrate.kind === 'board' && !S.sidecars.pro) toast('No .kicad_pro was loaded, so KiCad will apply its default design rules to this copy.', 'warn');
      for (const n of r.notes) toast(n, 'warn');
    },
    bond() {
      const dies = placedDies();
      download((dies.length > 1 ? 'wbx_die' : X.safe(dies[0].die.name)) + '.bondlist.csv', X.bondlist(S), 'text/csv');
      toast('Wrote the bondlist.');
    },
    svg() {
      const name = svgName();
      download(name, X.wbSvg(S), 'image/svg+xml');
      toast(`Wrote ${name}. Open it in a browser and hover a wire, pad or land.`);
    },
  };
  function svgName() {
    const dies = placedDies();
    return (S.substrate ? X.safe(S.substrate.fileName.replace(/\.[^.]+$/, '')) : dies.length > 1 ? 'wbx_die' : X.safe(dies[0].die.name)) + '.wb.svg';
  }

  /* ---- Diagram view: the .wb.svg the export would write, as a drawing, as code or both, kept up to date as you work ----
     The drawing goes in a shadow root, so its <style> can't reach the app and its <title>s still hover as they do in a browser.
     Copy and Download use the same text, so what's shown is what's written. It's only built while the view is showing. */
  const diag = { text: '', svg: null, aspect: 1, base: 0, zoom: 1, pane: 'picture', needFit: true, codeFor: null, timer: 0 };
  const shows = (p, what) => p === 'both' || p === what;
  // The code view shortens embedded images, so a die's artwork doesn't bury the rest. Copy and Download keep them whole.
  const shortData = s => s.replace(/(data:[\w/+.-]+;base64,)([A-Za-z0-9+/=]{120,})/g, (m, head, b) => `${head}${b.slice(0, 48)}…[${Math.max(1, Math.round(b.length * 0.75 / 1024))} KB image, shortened in this view]`);
  function hiAttrs(raw) {
    let out = '', last = 0;
    for (const a of raw.matchAll(/([\w:.-]+)=("[^"]*"|'[^']*')/g)) {
      out += esc(raw.slice(last, a.index)) + `<span class="${a[1].startsWith('wb:') ? 'sx-wb' : 'sx-a'}">${esc(a[1])}</span>=<span class="sx-v">${esc(a[2])}</span>`;
      last = a.index + a[0].length;
    }
    return out + esc(raw.slice(last));
  }
  // Colours tags, attributes and values; wb: attributes, the data, stand out from the drawing's own.
  const hiSvg = src => src.replace(/<!--[\s\S]*?-->|<[^>]*>|[^<]+/g, m => {
    if (m[0] !== '<') return esc(m);
    if (m.startsWith('<!--')) return `<span class="sx-c">${esc(m)}</span>`;
    const r = m.match(/^(<[/?]?)([^\s>/?]+)([\s\S]*?)(\/?\??>)$/);
    return r ? `<span class="sx-t">${esc(r[1] + r[2])}</span>${hiAttrs(r[3])}<span class="sx-t">${esc(r[4])}</span>` : `<span class="sx-t">${esc(m)}</span>`;
  });
  function sizeSvg() {
    const s = diag.svg;
    if (!s) return;
    const w = diag.base * diag.zoom;
    s.style.width = w + 'px'; s.style.height = w / diag.aspect + 'px';
  }
  function fitSvg() {
    const box = $('diagPicture');
    if (!diag.svg || !box.clientWidth) { diag.needFit = true; return; }
    diag.base = Math.max(60, Math.min(box.clientWidth - 2, (box.clientHeight - 2) * diag.aspect));
    diag.zoom = 1; diag.needFit = false;
    sizeSvg(); box.scrollTo(0, 0);
  }
  // Zoom by f about a point in the box, keeping that point under the pointer.
  function zoomSvg(f, cx, cy) {
    const box = $('diagPicture'), z0 = diag.zoom;
    if (!diag.svg) return;
    if (cx === undefined) { cx = box.clientWidth / 2; cy = box.clientHeight / 2; }
    diag.zoom = Math.min(60, Math.max(0.25, z0 * f));
    const k = diag.zoom / z0, x = box.scrollLeft + cx, y = box.scrollTop + cy;
    sizeSvg();
    box.scrollLeft = x * k - cx; box.scrollTop = y * k - cy;
  }
  // A new drawing keeps the zoom and scroll you had. Unzoomed, it refits, since a turned die or a new wire can change the crop.
  function showSvgPicture(text) {
    const box = $('diagPicture'), host = box.shadowRoot || box.attachShadow({ mode: 'open' });
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml'), bad = doc.querySelector('parsererror');
    const keep = [box.scrollLeft, box.scrollTop];
    diag.svg = null;
    if (bad) { host.innerHTML = `<p style="font:13px sans-serif;color:#a00;padding:16px">This SVG doesn't parse: ${esc(bad.textContent)}</p>`; return; }
    const svg = document.importNode(doc.documentElement, true);
    const vb = svg.viewBox.baseVal;
    diag.aspect = vb && vb.width && vb.height ? vb.width / vb.height : 1;
    svg.style.cssText = 'display:block;margin:0 auto;user-select:none';
    host.replaceChildren(svg);
    diag.svg = svg;
    if (diag.needFit || diag.zoom === 1) fitSvg();
    else { sizeSvg(); box.scrollTo(keep[0], keep[1]); }
  }
  function showSvgCode() {
    if (!shows(diag.pane, 'code') || diag.codeFor === diag.text) return;
    $('diagCode').innerHTML = hiSvg(shortData(diag.text));
    diag.codeFor = diag.text;
  }
  const diagShowing = () => app.mode === 'diagram';
  function queueDiagram() {
    if (!diagShowing()) return;
    clearTimeout(diag.timer);
    diag.timer = setTimeout(updateDiagram, 250);
  }
  function diagMessage(words) {
    const m = $('diagMsg');
    m.hidden = !words; m.textContent = words || '';
  }
  function updateDiagram() {
    clearTimeout(diag.timer);
    if (!diagShowing()) return;
    if (!placedDies().length) {
      diag.text = ''; diag.svg = null; diag.codeFor = null; diag.needFit = true;
      if ($('diagPicture').shadowRoot) $('diagPicture').shadowRoot.replaceChildren();
      $('diagCode').textContent = ''; $('diagMeta').textContent = '';
      diagMessage('Load a die to see its bond diagram. It follows every change you make, and is the file Bond diagram (.wb.svg) writes.');
      return;
    }
    let text;
    try { text = X.wbSvg(S); } catch (e) { console.error(e); diagMessage(`The diagram can't be drawn from this state yet: ${e.message}`); return; }
    diagMessage(null);
    if (text === diag.text) return;
    diag.text = text;
    showSvgPicture(text);
    showSvgCode();
    const kb = new Blob([text]).size / 1024, now = new Date();
    $('diagMeta').textContent = `${svgName()} · ${text.split('\n').length} lines · ${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB · updated ${now.toLocaleTimeString()}`;
  }
  function setDiagPane(p) {
    diag.pane = p;
    document.querySelectorAll('#diagTools [data-act=diagPane]').forEach(b => b.classList.toggle('on', b.dataset.tab === p));
    document.querySelectorAll('#diagTools [data-show]').forEach(e => { e.hidden = !shows(p, e.dataset.show); });
    $('diagBox').classList.toggle('both', p === 'both');
    $('diagPicture').hidden = !shows(p, 'picture');
    $('diagCode').hidden = !shows(p, 'code');
    showSvgCode();
    // The picture's box changed size: refit, keeping any zoom.
    if (shows(p, 'picture') && diag.svg) { const z = diag.zoom, was = diag.needFit; fitSvg(); if (!was) { diag.zoom = z; sizeSvg(); } }
  }
  function flashBtn(id, words) {
    const b = $(id);
    if (!b.dataset.words) b.dataset.words = b.textContent;
    b.textContent = words;
    clearTimeout(b._flash);
    b._flash = setTimeout(() => { b.textContent = b.dataset.words; }, 1400);
  }
  function bindDiagram() {
    const box = $('diagPicture');
    box.addEventListener('wheel', ev => {
      if (!diag.svg) return;
      ev.preventDefault();
      const r = box.getBoundingClientRect();
      zoomSvg(ev.deltaY < 0 ? 1.2 : 1 / 1.2, ev.clientX - r.left, ev.clientY - r.top);
    }, { passive: false });
    let drag = null;
    box.addEventListener('pointerdown', ev => {
      if (ev.button !== 0) return;
      drag = { x: ev.clientX, y: ev.clientY, sl: box.scrollLeft, st: box.scrollTop };
      box.setPointerCapture(ev.pointerId); box.classList.add('drag');
    });
    box.addEventListener('pointermove', ev => {
      if (!drag) return;
      box.scrollLeft = drag.sl - (ev.clientX - drag.x); box.scrollTop = drag.st - (ev.clientY - drag.y);
    });
    const end = () => { drag = null; box.classList.remove('drag'); };
    box.addEventListener('pointerup', end); box.addEventListener('pointercancel', end);
    $('diagWrap').addEventListener('change', ev => $('diagCode').classList.toggle('wrap', ev.target.checked));
    W.addEventListener('resize', () => {
      if (!diagShowing() || !diag.svg) return;
      const z = diag.zoom; fitSvg(); diag.zoom = z; sizeSvg();
    });
    // Nearly every change ends in a plan redraw, so that is what keeps the diagram current. It waits for a pause, and is
    // only built while showing.
    const draw = plan.draw.bind(plan);
    plan.draw = () => { draw(); queueDiagram(); };
  }
  const actions = {
    menu(el) { const m = $(el.dataset.menu), was = m.hidden; closeMenus(); m.hidden = !was; },
    sample: guarded(async el => { closeMenus(); await loadSample(el.dataset.sample); }),
    export(el) {
      closeMenus();
      if (!placedDies().length) { toast('Load a die first.', 'err'); return; }
      try { exporters[el.dataset.what](); } catch (e) { console.error(e); toast(e.message, 'err'); }
    },
    reset() { reset(); },
    pick(el) {
      const input = $('pickAny');
      input.dataset.role = el.dataset.role || '';
      input.accept = { substrate: '.kicad_pcb,.kicad_pro,.kicad_sch,.kicad_mod', 'die-gds': '.gds,.gds2,.gdsii,.gz', die: '.kicad_mod' }[el.dataset.role] || '.kicad_pcb,.kicad_pro,.kicad_sch,.kicad_mod,.gds,.gds2,.gdsii,.gz';
      input.value = '';
      input.click();
    },
    mode(el) {
      if (el.closest('#toolbar')) {
        app.mode = el.dataset.mode;
        document.querySelectorAll('#toolbar [data-act=mode]').forEach(b => b.classList.toggle('on', b === el));
        $('planBox').hidden = app.mode !== 'plan';
        $('tiltBox').hidden = app.mode !== '3d';
        $('diagBox').hidden = $('diagTools').hidden = app.mode !== 'diagram';
        // Hidden in 3D, keeping its place; taken out in the diagram view, so its own tools fit on the row.
        $('tools').style.visibility = app.mode === 'plan' ? '' : 'hidden';
        $('tools').hidden = app.mode === 'diagram';
        $('coord').hidden = app.mode !== 'plan';
        if (app.mode === '3d') { tilt.resize(); if (!tilt.fitted) { tilt.fit(); tilt.fitted = true; } }
        else if (app.mode === 'diagram') { setDiagPane(diag.pane); updateDiagram(); }
        else plan.resize();
      }
    },
    dieMode(el) { S.dieMode = el.dataset.mode; renderLeft(); },
    // A new die starts empty, selected, waiting for a file, and by hand: wires for it are the person's call.
    addDie() {
      const d = newSlot(nextDieId(), 'manual');
      S.dies.push(d);
      S.active = d.id;
      app.sel = null; app.preview = null;
      if (plan.rubber) { plan.rubber = null; plan.draw(); }
      renderAll(); save();
    },
    selectDie(el) { selectDie(el.dataset.id); },
    removeDie(el) {
      const d = M.dieById(S, el.dataset.id);
      if (!d) return;
      if (d.artToken) d.artToken.cancelled = true;
      // Whatever sat on it comes down to what it sat on, and says so.
      const under = M.dieSupport(S, d), moved = S.dies.filter(o => M.dieSupport(S, o) === d);
      for (const o of moved) o.place.on = under ? under.id : 'board';
      S.wires = S.wires.filter(w => !M.wireTouchesDie(S, w, d.id));
      S.dies = S.dies.filter(o => o !== d);
      if (!S.dies.length) S.dies = [newSlot('D1')];
      if (S.active === d.id) S.active = S.dies[S.dies.length - 1].id;
      app.sel = null; app.preview = null; app.flagged = null; app.flagId = null;
      syncSel();
      if (plan.rubber && plan.rubber.slot === d) plan.rubber = null;
      refreshLands();
      renderAll(); plan.fit(); save();
      toast(`Removed ${d.id} and its wires.` + (moved.length ? ` ${moved.map(o => o.id).join(', ')} now on ${under ? under.id : 'the board'}.` : ''));
    },
    tool(el) { setTool(el.dataset.tool); },
    rotate() { if (!S.die) return; rotateDie(S.place.rot + 90); app.onGeometry(false); },
    fit() { app.mode === 'plan' ? plan.fit() : app.mode === '3d' ? tilt.fit() : fitSvg(); },
    tab(el) { app.tab = el.dataset.tab; renderRight(); const m = markPanel(); if (m) m.scrollIntoView({ block: 'nearest' }); },
    autoPlace() {
      if (!S.die) return;
      const was = Object.assign({}, S.place), me = slot();
      M.autoPlace(S);
      carryStack(me, was);
      app.onGeometry(false); plan.fit();
    },
    swapRoles: guarded(async () => {
      const sub = S.substrate, die = S.die;
      const newDie = K.parseFootprintFile(sub.text).fps[0];
      if (!die.sourceText) { toast('Drop the two footprints again to swap them.', 'warn'); return; }
      loadSubstrateText(die.sourceText, die.fileName);
      await useFootprintDie(newDie, sub.fileName, { text: sub.text });
    }),
    unskipLands() { S.landSkip = []; refreshLands(); renderAll(); save(); },
    unremovePads: guarded(async () => { S.gdsOpts.removed = []; if (await ensureGds()) { await rebuildGds(); finishDie(); } }),
    clearFirst: guarded(async () => { S.gdsOpts.firstKey = null; if (await ensureGds()) { await rebuildGds(); finishDie(); } }),
    makeFirst: guarded(async () => { const p = selectedPad(); if (!p) return; S.gdsOpts.firstKey = p.key; if (await ensureGds()) { await rebuildGds(); app.sel = null; finishDie(); } }),
    removePad: guarded(async () => {
      const p = selectedPad();
      if (!p) return;
      app.sel = null;
      if (S.die.source === 'gds') { S.gdsOpts.removed.push(p.key); if (await ensureGds()) { await rebuildGds(); finishDie(); } }
      else { S.dieRemoved.push(p.key); applyNetOverrides(S.die); finishDie(); }
    }),
    skipLand() { const l = S.landBy.get(app.sel.slice(1)); if (!l) return; S.landSkip.push(l.id); app.sel = null; refreshLands(); pruneWires(); renderAll(); save(); },
    // Every selected wire. There's no undo, so deleting more than one asks first.
    delWire() {
      const gone = app.selWires;
      if (gone.size > 1 && !W.confirm(`Delete ${gone.size} wires? This can't be undone.`)) return;
      S.wires = S.wires.filter(w => !gone.has(w)); app.selWire = null; afterEdit();
    },
    resetEnds() { for (const w of app.selWires) { delete w.padOff; delete w.landOff; delete w.toPadOff; } afterEdit(); },
    togglePin() { app.selWire.pinned = !app.selWire.pinned; afterEdit(); },
    reassign() { for (const w of S.wires) if (!w.pinned) { const e = M.wireEnds(S, w); if (e) w.type = M.typeFor(S, e.pad.net || M.farNet(e)); } afterEdit(); },
    unpinAll() { for (const w of S.wires) w.pinned = false; afterEdit(); },
    addType() { let k = 1; while (S.types.some(t => t.name === 'TYPE' + k)) k++; S.types.push({ name: 'TYPE' + k, family: 'trapezoid', style: 'ball-wedge', material: 'Au', d: 25, dir: 'forward', moves: '200/0 0/15%', h: 200, p: 15, interp: 'spline', colour: '#8ad6fa' }); renderRight(); save(); },
    // Wires of a deleted type take the default, and if that was the default, Generic becomes it.
    delType(el) { const t = S.types[+el.dataset.i]; if (M.isBonderChoice(t)) return; S.types.splice(+el.dataset.i, 1); if (S.defaultType === t.name || !S.types.some(o => o.name === S.defaultType)) S.defaultType = M.GENERIC; for (const w of S.wires) if (w.type === t.name) w.type = S.defaultType; afterEdit(); },
    delRule(el) { S.typeRules.splice(+el.dataset.i, 1); renderRight(); save(); },
    // DRC rules panel.
    openDrc() {
      closeMenus();
      const d = $('drc');
      if (!d.dataset.ready) {
        d.dataset.ready = '1';
        // Keys typed here are for the panel, not the plan's shortcuts. A click on the backdrop closes it.
        d.addEventListener('keydown', ev => ev.stopPropagation());
        d.addEventListener('click', ev => { if (ev.target === d) d.close(); });
        $('pickRules').addEventListener('change', async ev => {
          const f = ev.target.files[0];
          if (!f) return;
          try {
            const r = DRC.importJson(S, await f.text());
            afterRules();
            toast(`Loaded ${r.count} rules from ${f.name}.` + (r.unknown.length ? ` Left out ${r.unknown.length} this app doesn't know: ${r.unknown.slice(0, 4).join(', ')}.` : ''));
          } catch (e) { toast(`${f.name} isn't a rule set this app can read: ${e.message}`, 'err'); }
        });
      }
      renderDrc();
      if (!d.open) d.showModal();
    },
    closeDrc() { $('drc').close(); },
    // Diagram view.
    diagPane(el) { setDiagPane(el.dataset.tab); },
    diagZoom(el) { zoomSvg(el.dataset.what === 'in' ? 1.5 : 1 / 1.5); },
    async diagCopy() {
      updateDiagram();
      if (!diag.text) return;
      try { await navigator.clipboard.writeText(diag.text); }
      catch (e) {
        // No clipboard API (some file:// setups): copy through a hidden textarea.
        const t = document.createElement('textarea');
        t.value = diag.text; t.style.cssText = 'position:fixed;opacity:0';
        document.body.append(t); t.select(); document.execCommand('copy'); t.remove();
      }
      flashBtn('diagCopyBtn', 'Copied');
    },
    diagDownload() {
      updateDiagram();
      if (!diag.text) return;
      download(svgName(), diag.text, 'image/svg+xml'); flashBtn('diagDlBtn', 'Downloaded');
    },
    drcReset() {
      const changed = DRC.TABLE.some(r => { const g = DRC.get(S, r.id); return g.changed || g.on !== (r.on !== false) || g.fromFile; });
      if (changed && !W.confirm('Put every DRC rule back to its default?')) return;
      S.rules = DRC.defaults(); afterRules(); toast('DRC rules are back to their defaults.');
    },
    drcExport() { download('wbx_drc_rules.json', DRC.exportJson(S), 'application/json'); toast('Wrote wbx_drc_rules.json.'); },
    drcImport() { const i = $('pickRules'); i.value = ''; i.click(); },
    addRule() { S.typeRules.push({ match: '', type: S.types[0].name }); renderRight(); },
  };
  function afterEdit() { computeRegimes(); renderRight(); renderInspector(); renderLoop(); plan.draw(); tilt.draw(); save(); }
  function finishDie() {
    indexDie(); pruneWires();
    if (S.regime !== 'manual') applyRegime(S.regime);
    computeRegimes(); renderAll(); save();
  }
  function closeMenus() { document.querySelectorAll('.menu').forEach(m => { m.hidden = true; }); }
  function setTool(t) {
    plan.tool = t; plan.rubber = null;
    document.querySelectorAll('#tools button').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
    plan.draw();
  }

  /* ---- input bindings ---- */
  const needsGds = async fn => { if (await ensureGds()) await fn(); };
  async function gdsBind(key, value) {
    S.gdsOpts[key] = value;
    await needsGds(async () => {
      if (key === 'cell') { await selectCell(value); S.die.fileName = gds.file ? gds.file.name : S.die.fileName; afterSources('die'); guarded(renderArt)(); return; }
      if (key === 'minUm' || key === 'maxUm') gds.cands = await G.padCandidates(gds.lib, gds.top, buildOptions(), ctlBusy('Looking for pads'));
      if (key === 'artPx') { await renderArt(); renderLeft(); return; }
      if (key === 'corner' || key === 'dir') S.gdsOpts.firstKey = null;
      await rebuildGds();
      finishDie();
    });
  }
  const binds = {
    maxLand(v) { S.maxLand = +v; refreshLands(); pruneWires(); if (S.die && !S.die.placed) M.autoPlace(S); renderAll(); plan.fit(); save(); },
    substrateFp(v) { S.substrate.selected = +v; S.landSkip = []; refreshLands(); for (const d of placedDies()) d.die.placed = false; placeDies(); regenWires(); renderAll(); plan.fit(); save(); },
    dieFromBoard: guarded(async v => { if (v === '') return; const i = +v; await useFootprintDie(S.substrate.board.fps[i], S.substrate.fileName, { boardIndex: i }); }),
    numberOffset(v) { S.numberOffset = parseInt(v, 10) || 0; if (S.regime === 'number') applyRegime('number'); computeRegimes(); renderAll(); save(); },
    'place.x'(v) { app.setPlace({ x: +v }); app.onGeometry(false); },
    'place.y'(v) { app.setPlace({ y: +v }); app.onGeometry(false); },
    'place.rot'(v) { rotateDie(+v); app.onGeometry(false); },
    'place.thick'(v) { S.place.thick = Math.max(0, +v); app.onGeometry(false); },
    'place.attach'(v) { S.place.attach = Math.max(0, +v); app.onGeometry(false); },
    'place.on'(v) {
      const me = slot(), P = S.place;
      // Switching to a custom height starts from where the die is now.
      if (v === 'custom') P.customUm = M.dieBottom(S, me);
      P.on = v;
      // Going on top of a die it isn't over at all: move it there. Anywhere else it already is over that die stays as it is.
      const sup = M.dieSupport(S, me);
      if (sup && !M.outlinesOverlap(me, sup)) {
        const [cx, cy] = M.dieToBoard(sup.place, ...M.dieCentre(sup.die)), [ax, ay] = K.rot(...M.dieCentre(S.die), P.rot);
        app.setPlace({ x: cx - ax, y: cy - ay });
        toast(`Moved ${me.id} to the middle of ${sup.id}. Drag it anywhere.`);
      }
      S.placeNote = null;
      app.onGeometry(false);
    },
    'place.customUm'(v) { S.place.customUm = Math.max(0, +v); app.onGeometry(false); },
    'bond.mode'(v) { S.bond.mode = v; renderLeft(); app.onGeometry(false); },
    'gds.cell': guarded(v => gdsBind('cell', v)),
    'gds.padLayer': guarded(v => gdsBind('padLayer', v)),
    'gds.corner': guarded(v => gdsBind('corner', v)),
    'gds.dir': guarded(v => gdsBind('dir', v)),
    'gds.minUm': guarded(v => gdsBind('minUm', +v)),
    'gds.maxUm': guarded(v => gdsBind('maxUm', +v)),
    'gds.peripheralOnly': guarded((v, el) => gdsBind('peripheralOnly', el.checked)),
    'gds.markText': guarded(v => gdsBind('markText', v)),
    'gds.artPx': guarded(v => gdsBind('artPx', +v)),
    layerOn: guarded(async (v, el) => { S.layers[+el.dataset.k].on = el.checked; await needsGds(renderArt); renderLeft(); }),
    layerColour: guarded(async (v, el) => { S.layers[+el.dataset.k].colour = v; await needsGds(renderArt); }),
    show(v, el) { plan.show[el.dataset.k] = el.checked; plan.draw(); tilt.draw(); },
    layerVis(v, el) { plan.vis[el.dataset.k] = el.checked; plan.draw(); tilt.draw(); },
    wireType(v, el) { S.wires[+el.dataset.i].type = v; afterEdit(); },
    // Sets every selected wire, then recomputes once. Like a single change, it doesn't pin them.
    selType(v) { if (v && app.selWires.size) { for (const w of app.selWires) w.type = v; afterEdit(); } },
    bulkPin(v) { for (const w of app.selWires) w.pinned = v; afterEdit(); },
    padNet(v) {
      const p = selectedPad();
      if (!p) return;
      S.netOverride[p.key] = v.trim();
      p.net = v.trim() || null;
      computeRegimes(); renderLeft(); renderRight(); renderInspector(); save();
    },
    defaultType(v) { S.defaultType = v; renderRight(); save(); },
    // DRC rule values, from the panel or the shortcuts in Checks. An empty or unreadable number leaves the rule as it was.
    'drc.value'(v, el) { const n = parseFloat(v); if (v === '' || !Number.isFinite(n)) { renderDrc(); renderRight(); return; } S.rules[el.dataset.rule].value = n; afterRules(); },
    'drc.on'(v, el) { S.rules[el.dataset.rule].on = !!v; afterRules(); },
    ...Object.fromEntries(Object.keys(DRC.LIMIT_KEYS).map(k => ['limit.' + k, v => { S.limits[k] = v; afterRules(); }])),
    'rule.match'(v, el) { S.typeRules[+el.dataset.i].match = v; save(); },
    'rule.type'(v, el) { S.typeRules[+el.dataset.i].type = v; save(); },
    'type.colour'(v, el) { S.types[+el.dataset.i].colour = v; afterEdit(); },
    'type.name'(v, el) {
      const t = S.types[+el.dataset.i], name = v.trim();
      if (M.isBonderChoice(t)) { renderRight(); return; }
      if (!name || M.RESERVED_NAME.test(name) || S.types.some(o => o !== t && o.name === name)) { toast('A type needs a name of its own.', 'warn'); renderRight(); return; }
      for (const w of S.wires) if (w.type === t.name) w.type = name;
      for (const r of S.typeRules) if (r.type === t.name) r.type = name;
      if (S.defaultType === t.name) S.defaultType = name;
      t.name = name; afterEdit();
    },
    'type.family'(v, el) {
      const t = S.types[+el.dataset.i];
      t.family = v;
      if (v !== 'custom') { t.h = t.h || 200; t.p = t.p === undefined ? 15 : t.p; t.moves = M.FAMILIES[v].make(t.h, t.p); t.interp = v === 'jedec4' ? 'polyline' : 'spline'; }
      afterEdit();
    },
    'type.d'(v, el) { S.types[+el.dataset.i].d = Math.max(1, +v); afterEdit(); },
    'type.material'(v, el) { S.types[+el.dataset.i].material = v; afterEdit(); },
    'type.style'(v, el) { S.types[+el.dataset.i].style = v; afterEdit(); },
    'type.dir'(v, el) { S.types[+el.dataset.i].dir = v; afterEdit(); },
    'type.moves'(v, el) {
      const t = S.types[+el.dataset.i];
      if (!M.parseMoves(v, 1000)) { el.classList.add('bad-input'); toast('Moves are steps like 200/0 30/12%: rise over run, starting at the first bond.', 'warn'); return; }
      t.moves = v.trim(); t.family = 'custom'; afterEdit();
    },
  };
  function liveBind(el) {
    const key = el.dataset.live;
    if (key === 'bond.mm') { S.bond.mm = +el.value; const o = $('bondOut'); if (o) o.textContent = fx(S.bond.mm); app.onGeometry(true); }
    else if (key === 'type.h' || key === 'type.p') {
      const t = S.types[+el.dataset.i];
      t[key === 'type.h' ? 'h' : 'p'] = +el.value;
      t.moves = M.FAMILIES[t.family].make(t.h || 200, t.p === undefined ? 15 : t.p);
      const card = el.closest('.type'), fresh = document.createElement('div');
      fresh.innerHTML = loopSvg(t);
      card.querySelector('svg').replaceWith(fresh.firstChild);
      card.querySelector('.moves').value = t.moves;
      plan.draw(); tilt.draw(); renderLoop();
    }
  }

  /* ---- wiring up ---- */
  function bindDom() {
    document.addEventListener('click', ev => {
      const a = ev.target.closest('[data-act]');
      if (a) { const f = actions[a.dataset.act]; if (f) f(a); return; }
      const rg = ev.target.closest('[data-regime]');
      if (rg && !ev.target.closest('input')) { applyRegime(rg.dataset.regime); app.preview = null; renderAll(); save(); return; }
      const ck = ev.target.closest('[data-check]');
      if (ck && !ev.target.closest('input')) {
        const c = app.checks.list.find(x => x.id === ck.dataset.check);
        if (app.flagId === c.id) { app.flagId = null; app.flagged = null; } else { app.flagId = c.id; app.flagged = new Set(c.wires); }
        renderRight(); plan.draw();
        return;
      }
      const tr = ev.target.closest('tr[data-wire]');
      if (tr && !ev.target.closest('select')) {
        pickRow(S.wires[+tr.dataset.wire], ev);
        selChanged();
        tr.closest('table').focus({ preventScroll: true });
        return;
      }
      if (!ev.target.closest('.menu')) closeMenus();
    });
    document.addEventListener('keydown', ev => {
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(ev.target.tagName)) { if (ev.key === 'Enter') ev.target.blur(); return; }
      const k = ev.key.toLowerCase();
      if (k === ' ') { plan.spaceDown = true; ev.preventDefault(); return; }
      if (ev.target.dataset && ev.target.dataset.regime && k === 'enter') { ev.target.click(); return; }
      // In the Wires list: Ctrl+A selects every wire, and the arrows move, with Shift to stretch. Text fields returned above, so they keep Ctrl+A.
      const inList = ev.target.closest && ev.target.closest('table.wires');
      if (inList && (ev.ctrlKey || ev.metaKey) && k === 'a') { ev.preventDefault(); selectAllWires(); return; }
      if (inList && (k === 'arrowdown' || k === 'arrowup')) { ev.preventDefault(); stepRow(k === 'arrowdown' ? 1 : -1, ev.shiftKey); return; }
      if (k === 'v') setTool('select');
      else if (k === 'w') setTool('wire');
      else if (k === 'm') setTool('move');
      else if (k === 'f') actions.fit();
      else if (k === 'r') actions.rotate();
      else if (k === 'escape') { plan.rubber = null; app.selWire = null; app.sel = null; closeMenus(); renderInspector(); renderLoop(); plan.draw(); tilt.draw(); markPanel(); }
      else if (k === 'delete' || k === 'backspace') { if (app.selWire) actions.delWire(); }
    });
    document.addEventListener('keyup', ev => { if (ev.key === ' ') plan.spaceDown = false; });
    const handleChange = ev => {
      const el = ev.target, key = el.dataset.bind;
      if (!key || !binds[key]) return;
      binds[key](el.type === 'checkbox' ? el.checked : el.value, el);
    };
    document.addEventListener('change', handleChange);
    document.addEventListener('input', ev => { if (ev.target.dataset.live) liveBind(ev.target); });
    document.addEventListener('change', ev => { if (ev.target.dataset.live) { computeRegimes(); renderLeft(); renderRight(); save(); } });
    $('tabBody').addEventListener('mouseover', ev => {
      const r = ev.target.closest('[data-regime]');
      const next = r && app.regimes[r.dataset.regime] && S.regime !== r.dataset.regime ? app.regimes[r.dataset.regime].wires : null;
      if (next !== app.preview) { app.preview = next; plan.draw(); }
    });
    // A modified click on a row selects rows, not text.
    $('tabBody').addEventListener('mousedown', ev => {
      const row = ev.target.closest('tr[data-wire]');
      if (!row || ev.target.closest('select') || !(ev.shiftKey || ev.ctrlKey || ev.metaKey)) return;
      ev.preventDefault();
      row.closest('table').focus({ preventScroll: true });
    });
    $('tabBody').addEventListener('mouseleave', () => { if (app.preview) { app.preview = null; plan.draw(); } });
    $('pickAny').addEventListener('change', ev => {
      const role = ev.target.dataset.role;
      const files = [...ev.target.files];
      if (files.length) loadFiles(files, role === 'substrate' ? 'substrate' : role === 'die' ? 'die' : undefined);
    });
    // drops
    let depth = 0;
    W.addEventListener('dragenter', ev => { ev.preventDefault(); depth++; $('dropHint').hidden = false; });
    W.addEventListener('dragleave', ev => { depth = Math.max(0, depth - 1); if (!depth) $('dropHint').hidden = true; });
    W.addEventListener('dragover', ev => ev.preventDefault());
    W.addEventListener('drop', ev => {
      ev.preventDefault(); depth = 0; $('dropHint').hidden = true;
      const files = [...ev.dataTransfer.files];
      if (!files.length) return;
      const zone = ev.target.closest && ev.target.closest('[data-drop]');
      const role = zone ? zone.dataset.drop : null;
      loadFiles(files, role === 'substrate' ? 'substrate' : role === 'die' ? 'die' : undefined);
    });
    $('zExag').addEventListener('input', ev => { tilt.zExag = +ev.target.value; $('zExagOut').textContent = ev.target.value + '×'; tilt.draw(); });
    W.addEventListener('resize', renderLoop);
  }

  async function boot() {
    plan = new V.PlanView($('plan'), app);
    tilt = new V.TiltView($('tilt'), app);
    app.plan = plan; app.tilt = tilt;
    bindDom();
    bindDiagram();
    const had = await restore();
    renderAll();
    if (had) { plan.fit(); toast('Picked up where you left off. Start over clears it.'); }
    app.ready = true;
  }
  app.gds = gds;
  app.refresh = renderAll;
  app.saveNow = saveNow;
  app.loadFiles = loadFiles;
  boot();
})(window);
