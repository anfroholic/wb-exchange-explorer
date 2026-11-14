/* Tips: the one place that says what each control and value means, and the one small tooltip that shows it.
   An element gets its tip from data-tip="key", or, without one, from what it already carries: data-bind="x" reads "bind:x",
   data-live="x" reads "live:x", and data-act="x" reads "act:x", or "act:x:<what|tool|mode|tab|sample|menu|role>" when that exists.
   An entry is a string, or a function of the element that returns one. Rule numbers are never written here: they come from the
   DRC rule table (rules.js) when the tip is shown, so a tip can't drift from the rule it explains. Blank lines start a new paragraph. */
(function (W) {
  'use strict';
  const D = document;
  const app = () => W.WBX.app, St = () => W.WBX.app.S, DRC = () => W.WBX.rules, M = () => W.WBX.model;
  const many = () => M().placedDies(St()).length > 1;
  const active = () => St().active;

  /* ---- rules: everything numeric comes from the table at show time ---- */
  const UNIT_WORDS = { '× d': 'multiples of the wire diameter (× d)', '°': 'degrees', '%': 'percent' };
  const unitWords = u => UNIT_WORDS[u] || u;
  const rule = id => DRC().get(St(), id);
  // The rule an element is about: its own data-rule, one inside it (a label round a switch), its DRC panel row, or its check's rule.
  const ruleIdOf = el => {
    if (el.dataset.rule) return el.dataset.rule;
    const inner = el.querySelector('[data-rule]');
    if (inner) return inner.dataset.rule;
    const row = el.closest('[data-drc]');
    if (row) return row.dataset.drc;
    const c = checkOf(el);
    return c && c.rule;
  };
  const checkOf = el => {
    const row = el.closest('[data-check]'), a = app();
    return row && a.checks ? a.checks.list.find(c => c.id === row.dataset.check) : null;
  };
  const tierWords = t => { const T = DRC().TIERS[t]; return T ? `${T.label}: ${T.what.replace(/\.?$/, '.')}` : ''; };
  function ruleMeaning(g) {
    let t = `${g.key} ${g.name}. ${g.meaning} Applies to: ${g.affects}`;
    if (g.enforce === 'specified') t += ' Wires left to the bonder are counted as not checked, never passed.';
    if (g.enforce === 'no') t += `\n\nNot enforced yet: ${g.why}`;
    return t;
  }
  function ruleBasis(g) {
    let t = `${tierWords(g.tier)}\n\nDefault ${g.def} ${g.unit}: ${g.condition} Source: ${DRC().BY_ID.get(g.id).source}.`;
    if (g.fromFile) t += `\n\nThis value came from a rule file, which names its source as: ${g.source}.`;
    else if (g.changed) t += `\n\nYou changed it to ${g.value} ${g.unit} here.`;
    if (g.tier === 'placeholder') t += '\n\nA placeholder only ever warns, so it can\'t read as an established violation.';
    return t;
  }
  function ruleValue(g) {
    return `${g.key} ${g.name}, in ${unitWords(g.unit)}. ` + (g.changed ? `Your value; the default is ${g.def} ${g.unit}. ` : 'This is the default. ') +
      'Changing it reruns the checks for every die at once and saves with the session. The Checks tab and DRC rules show the same value.';
  }

  /* ---- statuses ---- */
  const STATUS = {
    ok: 'Pass: everything this row covers is inside the limit. That is a comparison with the DRC rules, not a sign-off.',
    warn: 'Look: past a limit, or worth a look. Click the row to mark its wires in the plan. A placeholder rule, or one whose level is warn, never shows worse than this.',
    fail: 'Problem: past a limit this rule treats as a problem. Click the row to mark the wires, then change the placement, the wires or their type, or the rule if you have a better source.',
    info: 'Info: counted for you to see, not judged.',
    na: 'Not checked: nothing here could be judged, so this is not a pass. The value says why: often the wires are left to the bonder and this needs a wire size or loop, or there is nothing to compare yet.',
    off: 'Off: the rule is switched off, so nothing is checked and no wires are marked. Its switch is in DRC rules.',
  };
  function statusTip(el) {
    const cls = ['ok', 'warn', 'fail', 'info', 'na', 'off'].find(k => el.classList.contains(k));
    // In the Checks tab the row names its check; in DRC rules, the row's rule does.
    const row = el.closest('[data-drc]'), a = app();
    const c = checkOf(el) || (row && a.checks ? a.checks.list.find(x => x.rule === row.dataset.drc) : null);
    if (!c && !row) return 'Off: no glob top is set, so loop tops aren\'t compared with one. Type its height beside this to switch Glob top height (S4) on.';
    let t = STATUS[cls] || '';
    if (c && c.notChecked) t += `\n\n${c.notChecked} not checked: ${c.notChecked === 1 ? 'one wire is' : c.notChecked + ' wires are'} left to the bonder (Generic or Undefined), and this check needs a wire size or loop. Give ${c.notChecked === 1 ? 'it a type' : 'them a type'} in the Wires tab to check ${c.notChecked === 1 ? 'it' : 'them'}.`;
    return t;
  }

  /* ---- checks without a DRC rule of their own ---- */
  const CHECKS = {
    undefined: 'Wires whose type is Generic or Undefined. Their pad and far end are set, but not the wire or loop, so checks that need a size or loop skip them and say not checked.',
    crossz: 'Wires from different die, or ending on different die, that cross in plan. Their loop heights as drawn, less the wire sizes, are compared with the wire to wire gap rule (W5). Generic and undefined wires have no loop, so those pairs are counted as not compared.',
    overdie: 'Wires that pass over or under a die they don\'t bond to. For information: their clearance is in Clearance at die edge.',
    onpad: 'Each wire\'s first end must sit on its die pad, and the other on its land or pad, after any dragging. An end dragged off its target fails.',
    nets: 'Compares the net named at each end, for every wire where both ends are named. A mismatch may be a wrong pairing, or two names for one net. Not checked when pads or lands have no names.',
    moldstack: 'The top of the highest die, before any wire, against the glob top height. Runs with several die when Glob top height (S4) is on.',
    underdie: 'A land with a wire lies under a die outline at this placement, so it couldn\'t be reached. Move the die or the wire.',
    underupper: 'A pad with a wire lies under a higher die at this placement. Whether it could be bonded before the upper die goes on isn\'t judged.',
    overlap: 'Two die whose outlines and height ranges both overlap, so they\'d be in the same space. Change Sits on, or move one.',
    support: 'A die set to sit on another die but not over it in plan. Its height still comes from that die. Move it over, or change Sits on.',
    unbonded: 'Die pads, on every die, with no wire. For information: a pad may be left unbonded on purpose.',
    unusedland: 'Lands with no wire. For information.',
    notenforced: 'Rules that are switched on but that the app can\'t check yet, each with the reason. They never read as a pass. Switch them off in DRC rules if they don\'t apply.',
  };
  function checkLabel(el) {
    const c = checkOf(el);
    if (!c) return '';
    const base = c.rule ? ruleMeaning(rule(c.rule)) : CHECKS[c.id] || '';
    return base + (c.wires && c.wires.length ? '\n\nClick the row to mark its wires in the plan.' : '');
  }

  /* ---- regimes ---- */
  const REGIME_NEEDS = {
    number: 'Needs: pad numbers counted from pin 1, so for a GDS the Pin 1 corner and Direction (a footprint brings its own numbers), and numbered lands.\n\nPairs die pad n with the land numbered n + Offset. A pad with no such land gets no wire.',
    ring: 'Needs: only the geometry. No names or numbers.\n\nTakes pads and lands in angular order around the die, at the rotation with the least wire, so the wires don\'t cross. It knows nothing of your netlist, so compare it with Net names.',
    nets: 'Needs: net names on the pads (GDS labels, footprint nets, or names typed in the pad panel) and on the lands. A land net named pad_k means die pad k, counted from zero.\n\nPairs pads and lands on the same net, nearest first. A named pad with no land on its net may go to a pad on another die with the same net.',
    board: 'Needs: wires already in the board as wb_kind wire footprints, as this app exports them.\n\nTakes those pairs for every die and recalculates their geometry. It replaces the unpinned wires of every die.',
    drawn: 'Needs: lines on Cmts.User in the substrate footprint, each drawn from a pad to a land.\n\nSnaps each end of each line to the nearest pad and land within the distance given above.',
    manual: 'Needs: nothing.\n\nClears this die\'s unpinned wires and leaves the pairing to you, with the Wire tool (W).',
  };
  function regimeCard(el) {
    const k = el.dataset.regime, S = St(), mine = many() ? ` for ${active()}` : '';
    const inUse = S.regime === k ? `In use${mine}. Clicking it again reruns it, which brings back any unpinned wire it made and you deleted.\n\n` : '';
    if (k === 'manual') return inUse + `Click to clear the unpinned wires${mine} and add your own with the Wire tool. Pinned wires stay.`;
    if (k === 'board') return inUse + 'Click to use: replaces the unpinned wires of every die with the board\'s own. Pinned wires stay. Hover to see its wires dashed in the plan.';
    return inUse + `Click to use${mine}: replaces this die's unpinned wires with these.${many() ? ' Other die\'s wires stay.' : ''} Pinned wires stay. Hover to see its wires dashed in the plan.`;
  }
  // A regime's numbers cover the selected die, except From the board's, which cover every die.
  const allDies = el => { const c = el.closest('[data-regime]'); return !!c && c.dataset.regime === 'board'; };
  const regimeScope = el => allDies(el) ? 'the board\'s wires, for every die' : many() ? `the wires this regime would make for ${active()}` : 'the wires this regime would make';

  /* ---- export ---- */
  const dieCount = () => M().placedDies(St()).length;

  /* ---- the table ---- */
  const T = {
    // top bar
    'act:openDrc': 'The design rules behind the Checks: each limit\'s value, its on/off switch, how solid its source is and where it comes from. Changes apply to every die and save with the session.',
    'act:menu:sampleMenu': 'Load a bundled example to try the app. It clears the current session first, as Start over does.',
    'act:sample:gds': 'Clears the current session, then loads example.gds on example.kicad_pcb. The board already holds wb_ wire footprints, so From the board is used.',
    'act:sample:mods': 'Clears the current session, then loads a land ring and a die as two .kicad_mod files. No GDS, so the die has no artwork.',
    'act:menu:exportMenu': el => el.disabled
      ? 'Needs a die. Load a GDS or a footprint under Die first; then this writes files for KiCad.'
      : 'Write files for KiCad from this session. Each choice below downloads a file; nothing leaves the browser otherwise.',
    'act:export:board': () => 'Downloads <board>_bonded.zip: your board, or a new one around the footprint, with each die as a footprint, one footprint and 3D model per wire, and the WBLIB wire type library. Die, wires and library an earlier export put in the board are replaced. The rest of the board is kept as it was, apart from a user layer added for the wires when it needs one. Any .kicad_pro and .kicad_sch you loaded go with it.\n\nNeeds a substrate.',
    'act:export:fp': () => (dieCount() > 1
      ? `Downloads wbx_die_footprints.zip, holding wbx_die.pretty with one .kicad_mod per die (${dieCount()} now).`
      : 'Downloads the die as one .kicad_mod.') + ' Each has the outline on F.Fab and F.CrtYd, a numbered F.Fab rectangle per pad and the artwork image. No copper, so it adds nothing to the board\'s nets.',
    'act:export:kit': 'Downloads a zip with, for each die: its footprint in wbx_die.pretty, a schematic symbol (.kicad_sym), a 3D stand-in (.wrl) built from the thickness and attach under Placement, and a .die.json manifest of its pads.',
    'act:export:bond': () => 'Downloads a .csv with one row per wire, in list order: net, ends, x, y and z of each bond in bond order (µm, from the first die\'s centre), type, length and loop peak. Peak is empty for generic and undefined wires.' + (dieCount() > 1 ? ' With several die it adds to_kind and origin columns.' : ''),
    'act:export:svg': () => 'Downloads a .wb.svg, the wirebond.svg format in SPEC.md: a true-scale drawing of the bond area that tools read as data. It holds the lands, ' + (dieCount() > 1 ? 'each die' : 'the die') + ' with its pads, one line per wire named by its pad, land and type, a side view of the stack, and the loop profiles. Any browser opens it, and hovering a wire, pad or land shows its details. python wbx.py check reads it.\n\nDie thickness and attach are the assumed ones under Placement. Generic and undefined wires are drawn 20 µm wide; that is not a wire size.',
    'act:reset': 'Forgets every file, wire, type and DRC rule change in this browser, and starts empty. There\'s no undo.',

    // toolbar
    'act:mode:plan': 'Top-down view at true scale. Click to select; the tools (V, W, M) edit here.',
    'act:mode:3d': 'Orbit view of the board, the die stack and the wire loops. Click a wire to select it. The editing tools are hidden here.',
    'act:tool:select': 'Click a pad, land or wire to see it on the right. Drag a selected wire\'s white squares to move an end, which pins the wire. Ctrl+click wires to add or remove them. (V)',
    'act:tool:wire': () => `Click a pad then a land${many() ? ', or a pad on another die,' : ''} in either order, to add a wire. That order says nothing about which end is bonded first. New wires are pinned and get the type the Types tab gives. (W)`,
    'act:tool:move': 'Drag a die to move it, which selects it too. Die stacked on it go with it. Wire pairs are kept, and lengths and checks follow. (M)',
    'act:rotate': 'Turns the selected die 90° about its centre. Pairs are kept, and lengths, angles and checks are recomputed. Die stacked on it turn with it. (R)',
    'act:fit': 'Zooms the view to fit the board and die. (F)',
    'act:mode:diagram': 'The bond diagram (.wb.svg) the export writes, drawn here and kept up to date as you work: wires, pads, lands, the side view and loop profiles at true scale. Turn the die, change a wire or a type, and it redraws.',
    'act:diagPane:picture': 'The drawing, as a browser opens the file. Scroll to zoom where the pointer is, drag to pan, and hover a wire, pad, land or layer for its details. Fit (F) shows it whole.',
    'act:diagPane:both': 'The drawing and its code side by side.',
    'act:diagPane:code': 'The SVG text. wb: attributes, in pink, are the data a reader such as wbx.py check uses; the rest is drawing. A die\'s artwork image is shortened in this view; Copy and Download give the whole file.',
    'act:diagZoom:in': 'Zoom in on the middle of the drawing. The scroll wheel zooms where the pointer is.',
    'act:diagZoom:out': 'Zoom out from the middle of the drawing. The scroll wheel zooms where the pointer is.',
    'diag:wrap': 'Wrap long lines in the code. The file itself is unchanged.',
    'diag:meta': 'The file Download writes: its name, size, and when the drawing last changed.',
    'act:diagCopy': 'Copies the whole .wb.svg text to the clipboard, artwork included.',
    'act:diagDownload': 'Downloads this same file, as Bond diagram (.wb.svg) in the Put it in KiCad menu does.',
    'act:menu:showMenu': 'What the views draw. The first group is for the plan; board layers apply to the plan and 3D. Display only: nothing here changes the checks or the export.',
    'bind:show:art': 'Draw the die artwork from the GDS on the die in the plan. Display only.',
    'bind:show:labels': 'Draw pad and land numbers in the plan, and pad nets where there is room. Display only.',
    'bind:show:wires': 'Draw the wires in the plan. Display only: hidden wires are still checked and exported.',
    'bind:show:board': 'Draw the substrate board in the plan. Display only.',
    'bind:layerVis': 'Show this board layer in the plan and 3D views. Display only.',
    'zExag': 'Stretches heights in the 3D view, so loops and die thickness are easier to see. Display only: the checks, loop view and exports use true heights.',
    'zExagOut': 'The current height stretch in the 3D view. 1× is true scale.',
    'loopView': 'Side view of the selected wire, or of the longest wire when none is selected, at true scale, with the die on the left whichever end is bonded first.\n\nTop right: the type, metal and diameter, forward or reverse, span (straight plan distance, µm) and peak (loop top above the board, µm).\n\nThe dashed line and its number: the loop\'s clearance over the die edge, or under a die it runs beneath. Green meets Loop clearance over die edge (S1) in DRC rules, red doesn\'t.\n\nGeneric and undefined wires show only a stand-in path, so no clearance or peak.',

    // tabs
    'act:tab:regimes': 'Ways of pairing pads to lands, measured side by side. Click one to use it.',
    'act:tab:checks': 'Checks on every die and wire against the DRC rules. A red count is how many rows show a problem; an amber count, when there are none, how many to look at.',
    'act:tab:wires': 'Every wire as a list: select one or several and change their type. The count is how many wires there are.',
    'act:tab:types': 'Wire types (loop shape, diameter, metal) and the rules that pick a type from a net name.',

    // left: substrate
    'act:pick:substrate': 'Click to choose, or drop here, the .kicad_pcb or .kicad_mod whose pads the wires land on. Add the board\'s .kicad_pro and .kicad_sch to carry them into the export. A new substrate starts every die\'s wires again, pinned ones too.',
    'act:pick:': 'Choose any mix of .kicad_pcb, .kicad_mod, .gds, .gds.gz, .kicad_pro and .kicad_sch. Of two footprints, the one that fits inside the other is the die.',
    'bind:substrateFp': 'Which footprint in the board holds the lands. Whole board takes every front SMD pad. Changing it places every die again and starts the wires again.',
    'stat:lands': 'Front SMD pads short enough to count as lands (see What counts as a land). Wires end on these.',
    'stat:landNets': 'Lands with a net name. Net names and the net check use them, and each wire takes its wb_net from its land.',
    'stat:paddle': 'The paddle\'s width × height in mm: the biggest pad longer than a land may be. The die is placed on its centre. None when there isn\'t one.',
    'bind:maxLand': 'Longest side, in mm, a front SMD pad can have and still count as a land. The biggest pad over it is the paddle. Changing it reads the lands again and drops wires to lands that go.',
    'act:unskipLands': 'Brings back the pads you marked Not a land.',

    // left: die
    'act:dieMode:gds': 'Read this die from a GDS: size, pads, artwork and any net labels. This only shows the GDS drop zone; the die stays until you load another.',
    'act:dieMode:footprint': 'Read this die from a .kicad_mod, or a footprint in the board: outline and pads, no artwork. This only shows the footprint drop zone; the die stays until you load another.',
    'act:pick:die-gds': () => `Click to choose, or drop here, the die's .gds or .gds.gz. A new file finds the pads again and starts ${many() ? 'this die\'s' : 'the'} wires again, pinned ones too.`,
    'act:pick:die': () => `Click to choose, or drop here, a .kicad_mod to use as the die: its outline and pads. A new file starts ${many() ? 'this die\'s' : 'the'} wires again, pinned ones too.`,
    'bind:dieFromBoard': 'Use a footprint already in the board as this die, such as one exported earlier. It keeps its position in the board.',
    'stat:dieSize': 'The die outline, width × height in mm, as read from its file.',
    'stat:pads': 'Pads found on the die. Each can take a wire.',
    'stat:named': 'Pads with a net name, from GDS labels or footprint nets. Net names and the net check use them.',
    'stat:sides': 'How many pads the pad finder put on each edge of the die.',
    'act:swapRoles': 'Make the die the substrate and the substrate the die, for when the two footprints were taken the wrong way round.',
    'act:addDie': 'Adds a slot for another die, from a GDS or a footprint. It starts with no wires (By hand), and can sit on the board or on another die.',
    'act:selectDie': 'Select this die: Placement, the regimes and pad edits act on it. Clicking a die or its pad in the plan does the same.',
    'die:name': el => `${el.textContent}: the die's name, from its file.`,
    'die:sits': 'Where this die\'s underside is: on the board, on top of another die, or at a custom height in µm.',
    'act:removeDie': el => `Removes ${el.dataset.id} and every wire touching it. Die stacked on it come down to what it sat on. There's no undo.`,

    // left: GDS
    'bind:gds.cell': 'Which cell of the GDS is the die. Changing it finds the pads again and starts this die\'s wires again.',
    'bind:gds.padLayer': 'The GDS layer whose shapes are read as pads, best guess first. Each entry gives how many shapes share the most common size, and that size in µm. Changing it rebuilds the pads; wires to pads that go are dropped, and the regime runs again.',
    'bind:gds.corner': 'The corner where pad 1 is. Auto takes it from a pin 1 mark cell, else from label numbers, else assumes one, and the note below says which. Pad numbers, and so Number rule wires, follow it. Changing it undoes a pad 1 set by hand.',
    'bind:gds.dir': 'Which way pad numbers run around the die from pad 1. Number rule wires follow it. Changing it undoes a pad 1 set by hand.',
    'act:clearFirst': 'Numbers the pads from the Pin 1 corner and Direction again, forgetting the pad 1 you set by hand.',
    'bind:gds.minUm': 'Smallest side, in µm, a shape can have to count as a pad. Changing it looks for pads again.',
    'bind:gds.maxUm': 'Largest side, in µm, a shape can have to count as a pad. Changing it looks for pads again.',
    'bind:gds.peripheralOnly': 'Keep only pads near the die edge, dropping shapes further in. The count is how many it drops now.',
    'bind:gds.markText': 'A regular expression, case-insensitive, for the name of a cell that marks the pin 1 corner. Used when Pin 1 corner is Auto.',
    'act:unremovePads': 'Brings back the shapes you marked Not a pad.',
    'bind:gds.artPx': 'Pixel size of the artwork image drawn from the GDS. Higher is sharper, slower to draw, and larger in the saved session.',
    'bind:layerOn': el => { const n = el.querySelector && el.querySelector('small'); return 'Draw this GDS layer in the artwork. Display only: pads come from the pad layer whatever is drawn.' + (n ? ' The number is how many shapes it holds.' : ''); },
    'bind:layerColour': 'Colour of this layer in the artwork. Display only.',

    // left: placement
    'bind:place.x': 'Where the die\'s own origin (its GDS or footprint origin) sits on the board, in mm. Die stacked on it move with it. Wire pairs are kept; lengths and checks follow.',
    'bind:place.y': 'Where the die\'s own origin (its GDS or footprint origin) sits on the board, in mm. Die stacked on it move with it. Wire pairs are kept; lengths and checks follow.',
    'bind:place.rot': 'The die\'s rotation on the board. Pairs are kept; lengths, angles and checks follow, and die stacked on it turn with it. KiCad doesn\'t turn a footprint\'s image, so a rotated die loses its artwork in the exported board; its 3D model keeps it.',
    'bind:place.on': () => `Where ${active()}'s underside sits: the board, the top of another die plus the attach layer, or a custom height. On another die, its height follows that die's thickness, moves and turns.`,
    'bind:place.customUm': 'Height of the die\'s underside above the board\'s top, in µm. It sets the die\'s height for the loops, clearances, 3D view and export (wb_bottom_um).',
    'bind:place.thick': 'Die thickness in µm. A GDS doesn\'t hold it, so it is assumed until you set it. It sets the pad height, and so loop heights, die edge clearance, the glob top checks, Die edge to land (L3), anything stacked on it, and the 3D models. Exported as wb_thickness_um.',
    'bind:place.attach': 'Thickness of the die attach layer under the die, in µm, assumed. It lifts the die and everything on it. Exported as wb_attach_um.',
    'die:heights': 'The selected die\'s underside and top above the board\'s top, from Sits on, the attach layer and the thickness.',
    'act:autoPlace': 'Centres the die again on the paddle, or on the middle of the lands, at the rotation with the least wire. Die stacked on it go with it.',
    'place:lengths': 'Total wire length at each rotation, from the last automatic placement. The lowest is the one chosen.',
    'bind:bond.mode': 'Where the second bond lands on each land: a set distance in from the land\'s end nearest the die, or the land centre. It moves the land end of every wire not dragged by hand, so lengths, angles and checks change.',
    'live:bond.mm': 'Distance from the land\'s inner end to the second bond, in mm, up to half the land\'s length. Our own choice, not a sourced value: open question 8 in the plan.',
    'bond:out': 'The distance set by the slider, in mm.',
    'info:sitsOn': 'The board: the underside is on the board\'s top, lifted by the attach layer.\n\nTop of another die: on that die\'s top plus the attach layer. It follows when that die gets thicker, moves or turns, and it is exported as wb_sits_on and wb_bottom_um.\n\nA custom height: the underside at a height you type, starting from where it is now.\n\nThe checks then look for die in the same space, bonded pads under a higher die, and the stack under the glob top.',
    'info:secondBond': 'Nobody has told us where on a land the second bond should go, so it is a setting here, which lets lengths and angles be compared. In from the inner end gives shorter wires; Land centre is the plainest guess.\n\nA wire end you drag stays where you put it.',

    // right: regimes
    'regime': regimeCard,
    'tag:inUse': () => `The regime that made ${many() ? active() + '\'s' : 'the'} current wires, except any pinned ones.`,
    'tag:noRead': 'Nothing in your files for this regime to read, so it can\'t run. The ⓘ says what it needs.',
    'metric:wires': el => `How many of ${regimeScope(el)} there are. Pads free counts the ${allDies(el) ? 'pads, on every die,' : 'die\'s pads'} left without a wire.`,
    'metric:total': el => `Sum of the straight plan lengths, pad to far end, of ${regimeScope(el)}, in mm. ≈ when some are left to the bonder, whose length is only an estimate.`,
    'metric:longest': el => `The longest of ${regimeScope(el)}, straight pad to far end, in mm. Wire length, longest (W1) in DRC rules is ${rule('lengthMax').value} ${rule('lengthMax').unit} now.`,
    'metric:cross': el => `Pairs of ${regimeScope(el)} that cross in plan view. Wires crossing in plan (W4) in DRC rules allows ${rule('crossings').value} now.`,
    'metric:nets': 'Wires whose pad net matches the far end\'s net, out of those where both ends are named. n/a when nothing is named.',
    'bind:numberOffset': 'Added to each pad number to find its land: pad n goes to land n + Offset. Whole numbers. When Number rule is in use, this die\'s unpinned wires follow at once.',

    // right: checks
    'check': checkLabel,
    'check:value': 'What this check found, across everything it covers. The limit is beside it, and the line below says what is measured and where the limit comes from.',
    'status': statusTip,
    'tier': el => {
      const t = ['standard', 'vendor', 'thumb', 'placeholder'].find(k => el.classList.contains(k)), id = ruleIdOf(el);
      if (!id) return tierWords(t) + ' How solid a rule\'s default is. The number beside it is how many rules have this tier.' + (t === 'placeholder' ? ' A placeholder only ever warns.' : '');
      return ruleBasis(rule(id));
    },
    'bind:drc.value': el => ruleValue(rule(ruleIdOf(el))),
    'bind:drc.on': el => { const g = rule(ruleIdOf(el)); return `Switch ${g.key} on or off. Off means its check shows off and marks nothing; it never reads as a pass. Saved with the session and in the exported rule file.`; },
    'rule:globTop': () => ruleMeaning(rule('globTop')),
    'act:openDrc:tab': 'Opens DRC rules: every limit\'s value, switch, tier and source.',

    // right: wires
    'act:reassign': 'Sets the type of every unpinned wire from the type rules in the Types tab, or the default. Pinned wires keep theirs.',
    'act:unpinAll': 'Unpins every wire, so the next regime you pick can replace them.',
    'wires:table': 'Click a row to select it. Ctrl+click adds or removes a wire, Shift+click selects a range, Ctrl+A selects all, the arrows move, Esc clears.',
    'col:num': 'The wire\'s number: its place in the list, exported as wb_seq and as seq in the bondlist. ● marks a pinned wire.',
    'col:pad': () => `The die pad the wire starts from${many() ? ', as die.pad' : ''}. Which end is listed first says nothing about which is bonded first.`,
    'col:to': () => many() ? 'The far end: a land, or a pad on another die as die.pad.' : 'The land the wire goes to.',
    'col:net': 'The net at the pad, or else at the far end. Hover a long name to read all of it.',
    'col:type': 'The wire\'s type: its diameter and loop, which the size and height checks, 3D and export use. Changing it here doesn\'t pin the wire.',
    'col:mm': 'Straight plan distance from pad to far end, in mm. ≈ marks an estimate: a generic or undefined wire\'s real length depends on the loop the bonder picks.',
    'wires:pinned': 'Pinned: placed or edited by hand, so it survives changing regime. Unpin it in the panel below the plan.',
    'wires:estimate': 'An estimate: this wire is left to the bonder, so this is only the straight distance from pad to far end.',
    'wires:net': el => el.textContent ? `Net ${el.textContent}: at the pad, or else at the far end.` : 'No net at either end.',
    'bind:wireType': 'This wire\'s type: diameter, loop and metal for the loop view, 3D, the checks that need a size or loop, and wb_type in the export. Changing it doesn\'t pin the wire, so Reassign types by rule can change it again.',

    // right: types
    'act:addType': 'Adds a new type named TYPE1 or the next free number, as a trapezoid loop of 25 µm Au. Edit it below. No wire uses it until you pick it.',
    'type:generic': 'Generic: left to the bonder on purpose. Exported as wb_type GENERIC with a zero-width line. Can\'t be renamed or deleted.',
    'type:undefined': 'Undefined: nothing specified about the wire or loop. Exported as wb_type UNDEFINED with a dashed zero-width line. Can\'t be renamed or deleted.',
    'type:used': 'How many wires use this type now.',
    'type:loop': 'This type\'s loop at the median wire span, rising from the selected die\'s top, with the die on the left. Each type fits any span: the shape stretches.',
    'tag:default': 'The default type: new wires get it unless a type rule matches their net. Change it under Rules.',
    'bind:type.colour': 'Colour of this type\'s wires in the plan, 3D and loop views, and in the exported 3D models.',
    'bind:type.name': 'The type\'s name, exported as wb_type on each wire and as a wb_type_<name> field in the WBLIB library. Renaming updates its wires, its rules and the default. Must be unique.',
    'act:delType': 'Deletes this type. Its wires take the default type, and if it was the default, Generic becomes the default.',
    'bind:type.family': 'The loop shape. Any family but Custom rewrites Moves from Loop height and Top run. Custom keeps the Moves you type.',
    'bind:type.d': 'Wire diameter in µm. Every rule given in × d uses it, as do crossings between different die, the 3D tube and the line width in KiCad.',
    'bind:type.material': 'Wire metal. Written into the type library for whoever bonds it. No check uses it yet.',
    'bind:type.style': 'Ball-wedge or wedge-wedge bonding. Written into the type library for whoever bonds it. No check uses it yet.',
    'bind:type.dir': 'Which end is bonded first. On the die (forward) starts the loop at the die pad; on the land (reverse) starts it at the land. The loop shape over the die edge changes, and so does the bond order in the bondlist.',
    'live:type.h': 'Loop height in µm: the rise from the first bond. Rewrites Moves.',
    'live:type.p': 'Length of the flat run at the top, as a percentage of the span. Rewrites Moves. Triangle and JEDEC 4-point don\'t use it.',
    'bind:type.moves': 'The loop as rise/run steps from the first bond: rise in µm, run in µm or % of the span, as in 200/0 0/15%. Typing here makes the family Custom.',
    'info:firstBond': 'On the die (forward): the first bond is on the die pad and the loop rises from there. On the land (reverse): the first bond is on the land, and the wire comes down onto the die pad.\n\nThis records what you intend, for the loop drawing, the export and the bondlist. Nothing here has been checked with a bonder.',
    'bind:rule.match': 'A regular expression tested against the net name. The first rule that matches picks the type for new wires and for Reassign. A pattern that doesn\'t parse matches nothing.',
    'bind:rule.type': 'The type for wires whose net matches this rule.',
    'act:delRule': 'Deletes this rule.',
    'rule:else': 'Wires whose net matches no rule above get the default type, chosen beside this. The text can\'t be edited.',
    'bind:defaultType': 'The default type: new wires get it unless a rule above matches. Generic leaves the wire and loop to the bonder.',
    'act:addRule': 'Adds a type rule, matched before the default.',

    // inspector: one wire
    'tag:pinned': 'Pinned: placed or edited by hand, so it survives changing regime.',
    'insp:from': 'The die pad end of the wire, with its net. Which end is listed first says nothing about which is bonded first: that is the type\'s First bond.',
    'insp:to': 'The land, or the pad on another die, at the other end, with its net.',
    'insp:length': 'Straight plan distance from pad to far end, in mm. ≈ marks an estimate, for a wire left to the bonder.',
    'insp:angle': () => `Angle in plan between the wire and the line square to the die edge through its pad. Wire angle from pad normal (W3) allows ${rule('angleMax').value}° now.`,
    'insp:nets': 'Whether the pad\'s net and the far end\'s net are the same. Not comparable when either end has no net name.',
    'bind:selType': () => {
      const n = app().selWires.size;
      return n > 1 ? `Sets the type of all ${n} selected wires. Mixed means they differ now. Doesn't pin them.`
        : 'This wire\'s type: diameter, loop and metal for the loop view, 3D, the checks that need a size or loop, and wb_type in the export. Changing it doesn\'t pin the wire.';
    },
    'act:delWire': () => { const n = app().selWires.size; return n > 1 ? `Deletes all ${n} selected wires, after asking. There's no undo.` : 'Deletes this wire. There\'s no undo. (Delete)'; },
    'act:resetEnds': () => (app().selWires.size > 1 ? 'Puts the dragged ends of the selected wires back' : 'Puts this wire\'s dragged ends back') + ' where they\'d be undragged: the pad centre, and on a land where Where a wire ends on a land says.',
    'act:togglePin': () => app().selWire && app().selWire.pinned ? 'Unpin: the next regime you pick may replace this wire.' : 'Pin: keeps this wire when you change regime.',
    'bind:bulkPin': () => `Pin or unpin all ${app().selWires.size} selected wires. Pinned wires survive changing regime.`,
    // inspector: pad and land
    'insp:padSize': 'The pad opening, width × height in µm, as read from the file. The die pad rules in DRC use its short and long sides.',
    'insp:edge': 'The die edge the pad finder put this pad on.',
    'insp:padWires': 'Wires with an end on this pad. Bonds on one pad or land (P5) limits this.',
    'bind:padNet': 'This pad\'s net name, used by Net names, the net check, the type rules and the export. It replaces the name from the file for this session; leave it empty for no net.',
    'act:makeFirst': 'Number the pads from this one as pad 1, in the same direction. Pad numbers, Number rule wires and the export follow. Undo it under Pin 1 corner.',
    'act:removePad': () => St().die && St().die.source === 'gds'
      ? 'This shape isn\'t a pad: drops it, and its wires. Bring it back under How pads are found.'
      : 'Drops this pad from the die, and its wires, for this session. Loading the footprint again brings it back.',
    'insp:landNet': 'This land\'s net, from the substrate. A wire to it is exported with this as wb_net.',
    'insp:landSize': 'The land\'s width × height in mm.',
    'insp:footprint': 'The substrate footprint this land belongs to.',
    'insp:landWires': 'Wires ending on this land. Bonds on one pad or land (P5) limits this.',
    'act:skipLand': 'This pad isn\'t a land: drops it from the lands, with its wires. Bring it back under What counts as a land.',

    // DRC panel
    'act:closeDrc': 'Close the rules. Changes are already applied and saved. (Esc)',
    'act:drcReset': 'Puts every value and switch back to its default, after asking if anything changed.',
    'act:drcExport': 'Saves this rule set as wbx_drc_rules.json, with each value, switch, tier and source, to share or to hand to a bonding house.',
    'act:drcImport': 'Loads a rule set from a JSON file, such as one a bonding house sends back. Rules it doesn\'t name keep their values; ids this app doesn\'t know are left out and listed.',
    'drc:sheet': 'Opens docs/wire_bond_design_rules.svg, which draws every rule and where its number comes from. Opens when the app runs from this repo.',
    'drc:primer': 'Opens the wire bonding primer at its rule table, where each rule says why it matters. Opens when the app runs from this repo.',
    'top:primer': 'Opens the wire bonding primer in a new tab: what bonding is, the words for it, and why each rule is what it is. Opens when the app runs from this repo.',
    'drc:key': el => { const g = rule(ruleIdOf(el)); return `${g.key}: this rule's key on the spec sheet and in the sources notes.`; },
    'drc:source': 'Opens the document this default was read from.',
    'tag:notEnforced': el => { const g = rule(ruleIdOf(el)); return `Not enforced yet: ${g.why} Its value is kept and exported with the rule set, but it never reads as a pass.`; },
    'tag:nothingToCheck': 'On, but nothing in this session gives it anything to measure yet: no wire of the kind it needs, or only one die.',
    'info:drcLevels': 'Each rule has a level. A rule at fail shows problem when tripped; one at warn shows look. A placeholder only ever warns.\n\nApplies to says which wires a rule sees. Rules that need a wire size or loop skip wires left to the bonder and count them as not checked. Rules marked not enforced yet have no data to check against.\n\nThese numbers are for comparing options. Nothing here has been bonded, so none of it is a sign-off.',
  };
  // Regime ⓘ texts.
  for (const [k, v] of Object.entries(REGIME_NEEDS)) T['info:regime:' + k] = v;
  // The older limit inputs write into their rules, so they explain themselves as those rules.
  for (const [k, id] of Object.entries(W.WBX.rules.LIMIT_KEYS)) T['bind:limit.' + k] = () => ruleValue(rule(id));
  T['bind:limit.moldUm'] = () => `Height of your glob top above the board, in µm. 0 means there is none. Any other value switches Glob top height (S4) on, and loop tops${many() ? ' and the die stack' : ''} are checked under it.`;

  /* ---- reading a tip ---- */
  const SEL = '[data-tip],[data-bind],[data-live],[data-act],[data-regime]';
  function keyOf(el) {
    const d = el.dataset;
    if (d.tip) return d.tip;
    if (d.bind) return d.k !== undefined && T['bind:' + d.bind + ':' + d.k] ? 'bind:' + d.bind + ':' + d.k : 'bind:' + d.bind;
    if (d.live) return 'live:' + d.live;
    if (d.act) {
      const k = 'act:' + d.act, q = [d.what, d.tool, d.mode, d.tab, d.sample, d.menu, d.role].find(v => v !== undefined);
      if (d.act === 'openDrc' && el.closest('#tabBody')) return 'act:openDrc:tab';
      return q !== undefined && T[k + ':' + q] !== undefined ? k + ':' + q : k;
    }
    if (d.regime) return 'regime';
    return '';
  }
  function textFor(el) {
    let v = T[keyOf(el)];
    try { if (typeof v === 'function') v = v(el); } catch (e) { console.error('tip', keyOf(el), e); v = ''; }
    return v ? String(v) : '';
  }
  // Tips that only come with keyboard focus: the wire list is mostly rows, and hovering rows shouldn't keep raising its instructions.
  const FOCUS_ONLY = new Set(['wires:table']);
  // The element whose tip a node shows: the nearest one that has a tip.
  function anchorOf(node, hover) {
    let el = node && node.closest ? node.closest(SEL) : null;
    while (el && (!textFor(el) || (hover && FOCUS_ONLY.has(keyOf(el))))) el = el.parentElement ? el.parentElement.closest(SEL) : null;
    return el;
  }

  /* ---- the tooltip ---- */
  const DELAY = 400, WARM = 300, GAP = 6, EDGE = 6;
  let box = null, shown = null, pending = null, timer = 0, warmUntil = 0, muted = null, byKey = false, ptr = null, describedBy = false;
  const usePopover = () => box && typeof box.showPopover === 'function';
  const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function place(el) {
    const r = el.getBoundingClientRect(), vw = W.innerWidth, vh = W.innerHeight;
    // A tall element, like a card or the wire list, is explained next to the pointer rather than below the whole of it.
    let a = { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    if (r.height > 120) { const y = ptr ? Math.min(Math.max(ptr[1], r.top), r.bottom) : r.top + 10; a = { left: r.left, right: r.right, top: y - 12, bottom: y + 12 }; }
    const w = box.offsetWidth, h = box.offsetHeight, cx = (a.left + a.right) / 2;
    const clampX = x => Math.max(EDGE, Math.min(vw - w - EDGE, x)), clampY = y => Math.max(EDGE, Math.min(vh - h - EDGE, y));
    let x = clampX(cx - w / 2), y;
    if (a.bottom + GAP + h <= vh - EDGE) y = a.bottom + GAP;
    else if (a.top - GAP - h >= EDGE) y = a.top - GAP - h;
    else {
      y = clampY(a.top);
      if (a.right + GAP + w <= vw - EDGE) x = a.right + GAP;
      else if (a.left - GAP - w >= EDGE) x = a.left - GAP - w;
    }
    box.style.left = Math.round(x) + 'px'; box.style.top = Math.round(y) + 'px';
  }
  function show(el) {
    const text = el && el.isConnected ? textFor(el) : '';
    if (!text) { hide(); return; }
    if (shown && shown !== el) unlink();
    box.innerHTML = text.split(/\n\n+/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
    box.classList.toggle('why', !!el.disabled);
    if (usePopover()) { if (!box.matches(':popover-open')) box.showPopover(); }
    else {
      // Without popovers, a tip in a modal dialog has to live inside it to be drawn above it.
      const host = el.closest('dialog[open]') || D.body;
      if (box.parentNode !== host) host.appendChild(box);
      box.hidden = false;
    }
    box.style.left = '-9999px'; box.style.top = '0px';
    place(el);
    shown = el; pending = null;
    if (!el.hasAttribute('aria-describedby')) { el.setAttribute('aria-describedby', box.id); describedBy = true; }
  }
  function unlink() {
    if (shown && describedBy) shown.removeAttribute('aria-describedby');
    describedBy = false;
  }
  // warm: the pointer moved from one tip to the next, so the next shows without the wait. Any other hide starts the wait again.
  function hide(warm) {
    clearTimeout(timer); pending = null;
    warmUntil = warm === true && shown ? Date.now() + WARM : 0;
    if (!shown) return;
    unlink();
    shown = null;
    if (usePopover()) { if (box.matches(':popover-open')) box.hidePopover(); } else box.hidden = true;
  }
  function schedule(el, byPointer) {
    clearTimeout(timer);
    if (!el) { hide(byPointer); return; }
    if (el === shown) return;
    if (shown) hide(byPointer);
    pending = el;
    timer = setTimeout(() => { if (pending === el) show(el); }, Date.now() < warmUntil ? 0 : DELAY);
  }

  function init() {
    box = D.getElementById('uitip');
    if (!box) return;
    if (!usePopover()) { box.removeAttribute('popover'); box.hidden = true; }
    D.addEventListener('pointerover', ev => {
      if (ev.pointerType === 'touch') return;
      ptr = [ev.clientX, ev.clientY];
      const el = anchorOf(ev.target, true);
      if (el !== muted) muted = null;
      if (el && (el === shown || el === pending)) return;
      if (ev.buttons || (el && el === muted)) { hide(); return; }
      schedule(el, true);
    });
    D.addEventListener('pointerout', ev => { if (!ev.relatedTarget) { muted = null; hide(); } });
    // Pressing anything starts a click or a drag, so the tip goes, and stays gone over that element until the pointer leaves it.
    D.addEventListener('pointerdown', ev => {
      byKey = false;
      const info = ev.target.closest && ev.target.closest('.info');
      if (info) { ev.preventDefault(); return; }
      muted = shown || pending;
      hide();
    }, true);
    // An ⓘ shows its tip at once when clicked, and does nothing else: not the card or label it sits in.
    D.addEventListener('click', ev => {
      const info = ev.target.closest && ev.target.closest('.info');
      if (!info) return;
      ev.preventDefault(); ev.stopPropagation();
      if (shown === info) { muted = info; hide(); } else { clearTimeout(timer); show(info); }
    }, true);
    W.addEventListener('keydown', ev => {
      byKey = true;
      if (ev.key === 'Escape') { muted = shown || pending; hide(); warmUntil = 0; return; }
      const info = ev.target.closest && ev.target.closest('.info');
      if (info && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); ev.stopPropagation(); show(info); }
    }, true);
    // Keyboard focus shows the tip too, after the same wait. A click into a field doesn't, so it never covers what you're typing next to.
    D.addEventListener('focusin', ev => { if (byKey) { const el = anchorOf(ev.target); if (el && el !== muted) schedule(el); } });
    D.addEventListener('focusout', ev => { if (shown && (shown === ev.target || shown.contains(ev.target))) hide(); });
    D.addEventListener('input', () => { if (shown) hide(); }, true);
    D.addEventListener('scroll', () => { if (shown || pending) hide(); }, true);
    W.addEventListener('wheel', () => { if (shown || pending) hide(); }, { passive: true, capture: true });
    W.addEventListener('resize', hide);
    W.addEventListener('blur', hide);
  }
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', init); else init();

  W.WBX = W.WBX || {};
  W.WBX.tips = { TIPS: T, SEL, keyOf, textFor, anchorOf, show, hide, get shown() { return shown; } };
})(window);
