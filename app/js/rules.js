/* DRC rules: the one table of design rule defaults, with where each number comes from.
   docs/wire_bond_design_rules.svg is generated from this table by app/make_rules_svg.py, and a test checks the two agree.
   Nobody here has bonded anything, so every number carries its tier: a placeholder must never read as a standard.
   The rule set is optional. A session or a third party can switch any rule off, or replace the lot from a JSON file. */
(function (W) {
  'use strict';
  W.WBX = W.WBX || {};

  // BEGIN RULES JSON. Plain JSON between these markers: make_rules_svg.py and the tests read it as text.
  const TABLE = [
    {"id": "lengthMax", "key": "W1", "group": "Wire", "name": "Wire length, longest", "value": 6, "unit": "mm", "tier": "vendor", "level": "warn", "enforce": "all",
     "meaning": "Straight distance from first bond to second bond, in plan. The wire itself is longer by its loop.",
     "affects": "Every wire, including wires left to the bonder, whose length is an estimate.",
     "condition": "Standard service for 25 µm Au ball. Their table gives 4.5, 5.0, 6.0, 7.0 mm for 17.5, 20, 25, 33 µm wire.", "short": "25 µm Au ball; scales with wire",
     "source": "Europractice ASIC packaging rules 2024", "url": "https://europractice-ic.com/wp-content/uploads/2020/06/ASIC_Prototype_Packaging_Design_Rules_2024.pdf"},
    {"id": "lengthPerD", "key": "W2", "group": "Wire", "name": "Wire span per wire diameter", "value": 100, "unit": "× d", "tier": "thumb", "level": "warn", "enforce": "specified",
     "meaning": "Span no longer than this many wire diameters: the 100-D rule, against sag and sweep.",
     "affects": "Wires of a type with a diameter. 25 µm wire gives 2.5 mm.",
     "condition": "Molded packages, where mold flow sweeps wires. Shorter than Europractice's 6 mm for 25 µm.", "short": "molded packages; sag and sweep",
     "source": "US patent 5,923,092 (100-D rule)", "url": "https://patents.google.com/patent/US5923092A/en"},
    {"id": "angleMax", "key": "W3", "group": "Wire", "name": "Wire angle from pad normal", "value": 45, "unit": "°", "tier": "vendor", "level": "warn", "enforce": "all",
     "meaning": "Angle between the wire, in plan, and the line square to the die edge through the pad.",
     "affects": "Every wire.",
     "condition": "Europractice rule 10. Non-standard wire is 'to be discussed'.", "short": "25 µm Au ball",
     "source": "Europractice ASIC packaging rules 2024", "url": "https://europractice-ic.com/wp-content/uploads/2020/06/ASIC_Prototype_Packaging_Design_Rules_2024.pdf"},
    {"id": "crossings", "key": "W4", "group": "Wire", "name": "Wires crossing in plan", "value": 0, "unit": "wires", "tier": "vendor", "level": "fail", "enforce": "all",
     "meaning": "How many wires may cross another in plan, between wires from one die to the board.",
     "affects": "Every wire.",
     "condition": "Europractice: not allowed. MIL-STD-883 allows crossings in multi-tier packages at 2 wire diameters clearance.", "short": "single tier",
     "source": "Europractice ASIC packaging rules 2024", "url": "https://europractice-ic.com/wp-content/uploads/2020/06/ASIC_Prototype_Packaging_Design_Rules_2024.pdf"},
    {"id": "wireGap", "key": "W5", "group": "Wire", "name": "Wire to wire gap, plan", "value": 60, "unit": "µm", "tier": "placeholder", "level": "warn", "enforce": "all",
     "meaning": "Smallest plan-view distance between the centrelines of two wires that share no end.",
     "affects": "Every wire. Plan view only, so it ignores loop height.",
     "condition": "Ours. CERN's bond lab bonds 25 µm wire at 60 µm pitch, which is a pitch, not a gap.", "short": "ours; no source for a gap",
     "source": "This repo", "url": ""},
    {"id": "wireGapPerD", "key": "W6", "group": "Wire", "name": "Wire to wire separation per diameter", "value": 2, "unit": "× d", "tier": "standard", "level": "warn", "enforce": "specified",
     "meaning": "Gap between wire surfaces, as a multiple of the larger wire diameter.",
     "affects": "Pairs where both wires have a diameter. Plan view, which is conservative.",
     "condition": "MIL-STD-883 TM 2010 3.2.2a, class S. Class B is 1 × d. It is an inspection criterion, in any view.", "short": "class S; class B is 1 × d",
     "source": "MIL-STD-883G TM 2010.11", "url": "https://q-tech.com/wp-content/uploads/STD-883-2010.pdf"},
    {"id": "edgeClear", "key": "S1", "group": "Height", "name": "Loop clearance over die edge", "value": 40, "unit": "µm", "tier": "placeholder", "level": "fail", "enforce": "specified",
     "meaning": "Height of the wire above the die edge it crosses, or above any other die it passes over.",
     "affects": "Wires of a type with a loop.",
     "condition": "Ours, from the WBX example. MIL-STD-883 TM 2017 asks 1 mil (25 µm) within 5 mil of a ball bond.", "short": "ours",
     "source": "This repo", "url": ""},
    {"id": "edgeClearPerD", "key": "S2", "group": "Height", "name": "Die edge clearance per diameter", "value": 2, "unit": "× d", "tier": "standard", "level": "warn", "enforce": "specified",
     "meaning": "Clearance over the die edge as a multiple of the wire diameter.",
     "affects": "Wires of a type with a loop and a diameter.",
     "condition": "MIL-STD-883 TM 2017 3.1.6b, past the first 5 mil (ball) or 10 mil (wedge), to an unpassivated conductive die edge.", "short": "past 5 mil from the bond",
     "source": "MIL-STD-883G TM 2017.8", "url": "https://q-tech.com/wp-content/uploads/STD-883-2017.pdf"},
    {"id": "loopMax", "key": "S3", "group": "Height", "name": "Loop height, highest", "value": 2540, "unit": "µm", "tier": "vendor", "level": "warn", "enforce": "specified",
     "meaning": "Top of the loop above the board surface.",
     "affects": "Wires of a type with a loop.",
     "condition": "Samtec fine pitch wire bond table, dimension H, maximum wire height.", "short": "maximum, any wire",
     "source": "Samtec precision die attach design guide 2017", "url": "https://suddendocs.samtec.com/literature/advanced-package-design-guidlines.pdf"},
    {"id": "globTop", "key": "S4", "group": "Height", "name": "Glob top height", "value": 600, "unit": "µm", "tier": "vendor", "level": "fail", "on": false, "enforce": "specified",
     "meaning": "Your glob top's height above the board. Every loop top must sit under it. Off when there is no glob top.",
     "affects": "Wires of a type with a loop, and the die stack.",
     "condition": "Samtec's maximum encapsulation thickness, board surface to top. Set your own.", "short": "Samtec maximum; set yours",
     "source": "Samtec precision die attach design guide 2017", "url": "https://suddendocs.samtec.com/literature/advanced-package-design-guidlines.pdf"},
    {"id": "globCover", "key": "S5", "group": "Height", "name": "Glob top cover over loop", "value": 175, "unit": "µm", "tier": "vendor", "level": "warn", "enforce": "specified",
     "meaning": "Encapsulant thickness over the top of the highest loop. Runs only when the glob top height is on.",
     "affects": "Wires of a type with a loop.",
     "condition": "Samtec package encapsulation table, dimension D.", "short": "organic substrate",
     "source": "Samtec precision die attach design guide 2017", "url": "https://suddendocs.samtec.com/literature/advanced-package-design-guidlines.pdf"},
    {"id": "padMin", "key": "P1", "group": "Die pad", "name": "Die pad opening, smallest side", "value": 55, "unit": "µm", "tier": "vendor", "level": "warn", "enforce": "all",
     "meaning": "Short side of each die pad that has a wire.",
     "affects": "Every wired pad. Quoted for 25 µm wire, so only a guide for a wire left to the bonder.",
     "condition": "25 µm Au ball. Their table gives 40, 46, 55, 70 µm for 17.5, 20, 25, 33 µm wire.", "short": "25 µm Au ball; scales with wire",
     "source": "Europractice ASIC packaging rules 2024", "url": "https://europractice-ic.com/wp-content/uploads/2020/06/ASIC_Prototype_Packaging_Design_Rules_2024.pdf"},
    {"id": "padPerD", "key": "P2", "group": "Die pad", "name": "Die pad opening per wire diameter", "value": 3, "unit": "× d", "tier": "vendor", "level": "warn", "enforce": "specified",
     "meaning": "Short side of the pad as a multiple of the wire diameter.",
     "affects": "Pads with a wire of a type with a diameter.",
     "condition": "STFC, gold ball bonding. Stricter than Europractice, whose table works out near 2.2 × d.", "short": "Au ball; Europractice ≈ 2.2 × d",
     "source": "STFC Interconnect Lab guidelines", "url": "https://indico.global/event/1886/contributions/31130/attachments/15938/25564/Wire%20bond%20requirement10.pdf"},
    {"id": "padMax", "key": "P3", "group": "Die pad", "name": "Die pad opening, largest side", "value": 300, "unit": "µm", "tier": "placeholder", "level": "warn", "enforce": "all",
     "meaning": "Long side of each wired pad. A big pad bonds fine; this flags a shape that may have been read as a pad by mistake.",
     "affects": "Every wired pad.",
     "condition": "Ours: the pad finder's default upper size. A sanity check on pad finding, not a bonding limit.", "short": "ours; pad-finding sanity check",
     "source": "This repo", "url": ""},
    {"id": "padPitch", "key": "P4", "group": "Die pad", "name": "Die pad pitch", "value": 65, "unit": "µm", "tier": "vendor", "level": "warn", "enforce": "all",
     "meaning": "Centre to centre distance from each wired pad to the nearest other wired pad on the same die.",
     "affects": "Every wired pad.",
     "condition": "25 µm Au ball. Their table gives 50, 56, 65, 80 µm for 17.5, 20, 25, 33 µm wire.", "short": "25 µm Au ball; scales with wire",
     "source": "Europractice ASIC packaging rules 2024", "url": "https://europractice-ic.com/wp-content/uploads/2020/06/ASIC_Prototype_Packaging_Design_Rules_2024.pdf"},
    {"id": "bondsPerPad", "key": "P5", "group": "Die pad", "name": "Bonds on one pad or land", "value": 2, "unit": "bonds", "tier": "vendor", "level": "warn", "enforce": "all",
     "meaning": "How many wire ends may land on one die pad or one land.",
     "affects": "Every wire.",
     "condition": "Europractice: maximum wires per package finger or pad.", "short": "per pad or finger",
     "source": "Europractice ASIC packaging rules 2024", "url": "https://europractice-ic.com/wp-content/uploads/2020/06/ASIC_Prototype_Packaging_Design_Rules_2024.pdf"},
    {"id": "multiPad", "key": "P6", "group": "Die pad", "name": "Spacing of bonds on one die pad", "value": 75, "unit": "µm", "tier": "placeholder", "level": "warn", "enforce": "all",
     "meaning": "Centre to centre distance between two bonds on one die pad. Where nobody set the positions, whether the pad's long side has room for them.",
     "affects": "Pads with more than one wire.",
     "condition": "Ours: one ball of 3 × d for 25 µm wire. MIL-STD-883 lets a bond shrink its neighbour's width by up to 25%.", "short": "ours; one 25 µm ball width",
     "source": "This repo", "url": ""},
    {"id": "landMin", "key": "L1", "group": "Land", "name": "Land, smallest side", "value": 100, "unit": "µm", "tier": "vendor", "level": "warn", "enforce": "all",
     "meaning": "Short side of each land that has a wire.",
     "affects": "Every wired land.",
     "condition": "Samtec wire bond pad, organic substrate. Ceramic is 75 µm.", "short": "organic; ceramic 75 µm",
     "source": "Samtec precision die attach design guide 2017", "url": "https://suddendocs.samtec.com/literature/advanced-package-design-guidlines.pdf"},
    {"id": "landPitch", "key": "L2", "group": "Land", "name": "Land pitch", "value": 200, "unit": "µm", "tier": "vendor", "level": "warn", "enforce": "all",
     "meaning": "Centre to centre distance from each wired land to the nearest other land.",
     "affects": "Every wired land.",
     "condition": "Samtec wire bond pad pitch, organic substrate. Ceramic is 150 µm.", "short": "organic; ceramic 150 µm",
     "source": "Samtec precision die attach design guide 2017", "url": "https://suddendocs.samtec.com/literature/advanced-package-design-guidlines.pdf"},
    {"id": "landToDie", "key": "L3", "group": "Land", "name": "Die edge to land", "value": 375, "unit": "µm", "tier": "vendor", "level": "warn", "enforce": "all",
     "meaning": "Plan distance from the die outline to the nearest edge of each wired land, or twice the die thickness if that is more.",
     "affects": "Every wire to a land. Die thickness is assumed unless you set it.",
     "condition": "Samtec dimension F: 375 µm or 2 × die thickness, whichever is greater. Assumes no ground plane for die attach.", "short": "or 2 × die thickness",
     "source": "Samtec precision die attach design guide 2017", "url": "https://suddendocs.samtec.com/literature/advanced-package-design-guidlines.pdf"},
    {"id": "multiLand", "key": "L4", "group": "Land", "name": "Spacing of bonds on one land", "value": 300, "unit": "µm", "tier": "vendor", "level": "warn", "enforce": "all",
     "meaning": "Centre to centre distance between two bonds on one land. Where nobody set the positions, whether the land's long side has room for them.",
     "affects": "Lands with more than one wire.",
     "condition": "CERN bond lab: minimum preferable in-line distance between two bonds; tool and loop dependent.", "short": "in line; tool dependent",
     "source": "CERN bond lab recommendations", "url": "https://bondlab.web.cern.ch/Recommendations.html"},
    {"id": "damToLand", "key": "L5", "group": "Land", "name": "Glob top dam to land", "value": 300, "unit": "µm", "tier": "vendor", "level": "warn", "enforce": "no",
     "why": "No dam is drawn in the substrate data yet.",
     "meaning": "Plan distance from the glob top dam to the outer edge of the lands.",
     "affects": "Nothing yet.",
     "condition": "Samtec package encapsulation table: dam width 300 µm, dam to wire bond lead edge 300 µm.", "short": "organic substrate",
     "source": "Samtec precision die attach design guide 2017", "url": "https://suddendocs.samtec.com/literature/advanced-package-design-guidlines.pdf"},
    {"id": "dieToDie", "key": "D1", "group": "Die", "name": "Die to die, side by side", "value": 250, "unit": "µm", "tier": "vendor", "level": "warn", "enforce": "all",
     "meaning": "Plan distance between the outlines of two die that do not overlap.",
     "affects": "Sessions with more than one die.",
     "condition": "Europractice die to die distance, minimum.", "short": "minimum",
     "source": "Europractice ASIC packaging rules 2024", "url": "https://europractice-ic.com/wp-content/uploads/2020/06/ASIC_Prototype_Packaging_Design_Rules_2024.pdf"},
    {"id": "stackStep", "key": "D2", "group": "Die", "name": "Stacked die step to a bonded pad", "value": 250, "unit": "µm", "tier": "placeholder", "level": "warn", "enforce": "all",
     "meaning": "Plan distance from a bonded pad on a lower die to the edge of a die stacked above it.",
     "affects": "Sessions with a die on another die.",
     "condition": "Ours: no source found. Borrowed from Europractice's side-by-side die to die distance.", "short": "ours; no source found",
     "source": "This repo", "url": ""},
    {"id": "keepout", "key": "K1", "group": "Keepout", "name": "Keepout to parts with height", "value": 45, "unit": "°", "tier": "vendor", "level": "warn", "enforce": "no",
     "why": "The app has no component heights yet.",
     "meaning": "Nothing may rise above a 45° line up and out from each bond, so the bond head fits. A part of height h stays about h away.",
     "affects": "Nothing yet.",
     "condition": "STFC: 'need at least 45 degree angle clearance on all sides'. CERN adds half the capillary tip diameter.", "short": "plus half the tool tip",
     "source": "STFC Interconnect Lab guidelines", "url": "https://indico.global/event/1886/contributions/31130/attachments/15938/25564/Wire%20bond%20requirement10.pdf"},
    {"id": "ballSize", "key": "B1", "group": "Bond", "name": "Ball bond diameter", "value": 2, "unit": "× d", "tier": "standard", "level": "warn", "enforce": "no",
     "why": "The app has no bond footprint, only a bond point.",
     "meaning": "Smallest ball diameter as a multiple of the wire diameter. The largest is 5 × d.",
     "affects": "Nothing yet. It sizes pads and bond spacing.",
     "condition": "MIL-STD-883 TM 2010 3.2.1.1a: reject below 2.0 × d or above 5.0 × d, gold ball.", "short": "to 5 × d; gold ball",
     "source": "MIL-STD-883G TM 2010.11", "url": "https://q-tech.com/wp-content/uploads/STD-883-2010.pdf"},
    {"id": "wedgeWidth", "key": "B2", "group": "Bond", "name": "Wedge bond width", "value": 1.2, "unit": "× d", "tier": "standard", "level": "warn", "enforce": "no",
     "why": "The app has no bond footprint, only a bond point.",
     "meaning": "Smallest ultrasonic wedge width as a multiple of the wire diameter. Largest 3 × d; length 1.5 to 6 × d.",
     "affects": "Nothing yet. It sizes pads and lands for wedge bonds.",
     "condition": "MIL-STD-883 TM 2010 3.2.1.2a, ultrasonic wedge. Thermosonic is 1.5 to 3 × d.", "short": "ultrasonic; to 3 × d",
     "source": "MIL-STD-883G TM 2010.11", "url": "https://q-tech.com/wp-content/uploads/STD-883-2010.pdf"},
    {"id": "bondInPad", "key": "B3", "group": "Bond", "name": "Bond inside the pad opening", "value": 75, "unit": "%", "tier": "standard", "level": "warn", "enforce": "no",
     "why": "The app has no bond footprint. It checks that the bond point is on the pad instead.",
     "meaning": "Share of the bond's area that must sit inside the unglassivated pad opening.",
     "affects": "Nothing yet.",
     "condition": "MIL-STD-883 TM 2010 3.2.1.4a, class S. Class B is 50%.", "short": "class S; class B 50%",
     "source": "MIL-STD-883G TM 2010.11", "url": "https://q-tech.com/wp-content/uploads/STD-883-2010.pdf"}
  ];
  // END RULES JSON

  const TIERS = {
    standard: { label: 'Standard', short: 'STD', what: 'Read in a published standard' },
    vendor: { label: 'Vendor guide', short: 'VENDOR', what: 'Read in a packaging house, vendor or bonding lab guide' },
    thumb: { label: 'Rule of thumb', short: 'THUMB', what: 'Read as a rule of thumb in a published source' },
    placeholder: { label: 'Placeholder', short: 'PLACEHOLDER', what: 'Ours. No source: change it' },
  };
  const BY_ID = new Map(TABLE.map(r => [r.id, r]));
  // Old sessions held five limits. Each is now a rule; S.limits stays as a view onto them, so older code keeps working.
  const LIMIT_KEYS = { lengthMm: 'lengthMax', angleDeg: 'angleMax', gapUm: 'wireGap', edgeUm: 'edgeClear', moldUm: 'globTop' };
  // The checks that existed before the rules, by their check id.
  const CHECK_RULE = { length: 'lengthMax', angle: 'angleMax', cross: 'crossings', gap: 'wireGap', edge: 'edgeClear', padsize: 'padMin', pitch: 'padPitch', mold: 'globTop' };

  const defaultOn = r => r.on !== false;
  // A session's rule set: { id: { value, on } }, plus tier and source when a file named its own.
  function defaults() {
    const o = {};
    for (const r of TABLE) o[r.id] = { value: r.value, on: defaultOn(r) };
    return o;
  }
  function normalise(src) {
    const o = defaults();
    if (!src || typeof src !== 'object') return o;
    for (const id of Object.keys(o)) {
      const s = src[id];
      if (s === undefined || s === null) continue;
      if (typeof s === 'number') { o[id].value = s; continue; }
      if (typeof s !== 'object') continue;
      if (s.value !== undefined && s.value !== '' && Number.isFinite(+s.value)) o[id].value = +s.value;
      if (typeof s.on === 'boolean') o[id].on = s.on;
      if (s.tier && TIERS[s.tier]) o[id].tier = s.tier;
      if (s.source) o[id].source = String(s.source).slice(0, 200);
    }
    return o;
  }
  const stateOf = (S, id) => {
    if (!S.rules || typeof S.rules !== 'object') S.rules = defaults();
    if (!S.rules[id]) S.rules[id] = defaults()[id];
    return S.rules[id];
  };
  // Everything about one rule as this session has it: the table row, its value and switch, and whose number it is now.
  function get(S, id) {
    const r = BY_ID.get(id), s = stateOf(S, id);
    const changed = s.value !== r.value;
    return Object.assign({}, r, { value: s.value, on: s.on, def: r.value, changed, tier: s.tier || r.tier, source: s.source || r.source, fromFile: !!s.source });
  }
  const on = (S, id) => stateOf(S, id).on;
  const value = (S, id) => stateOf(S, id).value;

  // S.limits as accessors over S.rules. Assigning S.limits, as old sessions and Start over do, writes its values into the rules.
  function attach(S) {
    if (!S.rules) S.rules = defaults();
    const view = {};
    for (const [k, id] of Object.entries(LIMIT_KEYS)) {
      Object.defineProperty(view, k, {
        enumerable: true,
        get: () => k === 'moldUm' ? (on(S, id) ? value(S, id) : 0) : value(S, id),
        set: v => setLimit(S, k, v),
      });
    }
    Object.defineProperty(S, 'limits', { enumerable: true, configurable: true, get: () => view, set: v => migrate(S, v) });
  }
  function setLimit(S, k, v) {
    const s = stateOf(S, LIMIT_KEYS[k]);
    v = +v;
    if (!Number.isFinite(v)) return;
    if (k === 'moldUm') { if (v > 0) { s.value = v; s.on = true; } else s.on = false; }
    else s.value = v;
  }
  function migrate(S, limits) {
    if (!limits || typeof limits !== 'object') return;
    for (const k of Object.keys(LIMIT_KEYS)) if (limits[k] !== undefined) setLimit(S, k, limits[k]);
  }

  /* Checks carry their rule. Off means off; a tripped placeholder warns and never fails, so it can't read as an established violation. */
  function decorate(S, list) {
    for (const c of list) {
      const id = c.rule || (BY_ID.has(c.limitKey) ? c.limitKey : CHECK_RULE[c.id]);
      if (!id || !BY_ID.has(id)) continue;
      const g = get(S, id);
      c.rule = id; c.tier = g.tier; c.source = g.source; c.ruleKey = g.key;
      if (!g.on) { c.status = 'off'; c.value = 'off in DRC rules'; c.wires = []; c.notChecked = 0; continue; }
      if (c.status === 'fail' || c.status === 'warn') c.status = g.tier === 'placeholder' ? 'warn' : g.level;
    }
    return list;
  }
  const notEnforced = () => TABLE.filter(r => r.enforce === 'no');

  function exportJson(S) {
    return JSON.stringify({
      format: 'wbx-drc-rules', version: 1,
      note: 'Wire bond DRC rules from Wire Bond Bench. Edit value and on, and add a source and tier (standard, vendor, thumb, placeholder) for any number you give.',
      rules: TABLE.map(r => { const g = get(S, r.id); return { id: r.id, key: r.key, name: r.name, value: g.value, unit: r.unit, on: g.on, tier: g.tier, source: g.source, url: g.fromFile ? '' : r.url, condition: r.condition, default: r.value }; }),
    }, null, 1);
  }
  // Takes this app's own file, a list of { id, value, on }, or a plain { id: value } map. Unknown ids are reported and left out.
  function importJson(S, text) {
    const data = JSON.parse(text);
    const list = Array.isArray(data) ? data : Array.isArray(data.rules) ? data.rules : null;
    const map = {};
    const unknown = [];
    if (list) for (const r of list) { if (r && BY_ID.has(r.id)) map[r.id] = r; else unknown.push(r && r.id); }
    else for (const [k, v] of Object.entries(data.rules || data)) { if (BY_ID.has(k)) map[k] = v; else if (!['format', 'version', 'note'].includes(k)) unknown.push(k); }
    // A file's tier is kept only where it gives a source too, and a value from the file that matches our default keeps our source.
    for (const [id, r] of Object.entries(map)) {
      if (r && typeof r === 'object' && r.source && r.source === BY_ID.get(id).source) { delete r.source; delete r.tier; }
      if (r && typeof r === 'object' && !r.source) delete r.tier;
      // Someone else's number with a source but no tier we know reads as a vendor guide: it is theirs, not ours.
      if (r && typeof r === 'object' && r.source && !TIERS[r.tier]) r.tier = 'vendor';
    }
    S.rules = normalise(Object.assign({}, S.rules, map));
    return { count: Object.keys(map).length, unknown: unknown.filter(Boolean) };
  }

  W.WBX.rules = { TABLE, TIERS, BY_ID, LIMIT_KEYS, CHECK_RULE, defaults, normalise, get, on, value, attach, migrate, decorate, notEnforced, exportJson, importJson };
})(window);
