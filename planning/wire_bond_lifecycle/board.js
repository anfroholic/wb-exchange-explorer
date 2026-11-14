/* ============================================================================
   Wire Bond Lifecycle — board DATA. Loaded before
   ../_planning_tools/board.engine.js, which reads window.DOC and renders. The
   engine is generic; only this file is board-specific. Schema + chapter-folding
   protocol: ../_planning_tools/PROTOCOL.md
   ========================================================================== */
window.DOC = {
  boardId: "wire_bond_lifecycle",
  title: "Wire Bond Lifecycle",
  about: "How a die gets from **GDS** through a generated **KiCad** kit and wire types to bonder outputs, where data may enter, and what still works when some of it is missing. Answer the open questions in the **Current Plan** tab or on the cards, then hit **📋 Copy JSON for Claude** and paste it into the chat.",
  chapterLegend: [
    {ch:1, t:"framing: GDS owns the die, KiCad is the base model, a pin 1 and a direction is the minimum. Prototype die kit and generated wires ran on real chips. Five questions open."},
    {ch:2, t:"your answers, plus a rerun on the run 2 COBs: the pin rule holds, the 180° mount is gone. Existing conventions surveyed. Type library moves into the board file. Run 2 bonding PDFs found to have pad names half a ring off."},
  ],
  chapter: 2,
  planDoc: {href:"plan.html", ch:2},

  cards: [

  {id:"GOAL", title:"Goal — from GDS to a bonded board, with whatever data exists", status:"info",
    state:"GDS defines the die, KiCad defines the assembly, everything else is generated. Each stage runs with partial data and names what it assumed. Each layer can be skipped by people who don't want the whole stack.",
    changes:[{ch:1, t:"framing"}, {ch:2, t:"lightness added as a requirement"}],
    stream:[
      {ch:1, by:"user", t:"The GDS is our source of truth on what a die is and where its pads are. Net names would be ideal but aren't a requirement. We want a render in KiCad showing the completed assembly while we develop the board, before or after we actually have the chip. KiCad is the base model; other EDA tools are not our problem."},
      {ch:1, by:"claude", t:"Agreed, and it simplifies things: two sources of truth, and every other file is generated from them. That replaces [docs/report.md](../../docs/report.md)'s position, where WBX owned connectivity. `.wb.svg` becomes a generated handoff file that nothing reads back. See [the lifecycle](plan.html#life) and [who owns what](plan.html#own)."},
    ]},

  {id:"PARTIAL", title:"Partial data — only block what can't be guessed safely", status:"info",
    state:"Footprint needs geometry only. Symbol, 3D and wires run with stated fallbacks. Exports are marked DRAFT until the data is real.",
    changes:[{ch:1, t:"framing"}],
    stream:[
      {ch:1, by:"claude", t:"Tried with labels, the marker and the render all turned off: the footprint, symbol and 3D block still generate, and all 74 wires still pair in the right order. The [explorer](plan.html#partial) shows each output for any mix of inputs. The slot template path for when no chip exists yet is designed but not built."},
    ]},

  {id:"RUN2", title:"Run 2 COBs — the boards this plan now uses", status:"info",
    state:"Three of the four run 2 boards are tested, each paired with a real die. WSLG and HZ80 are run 1 stand-ins, because no run 2 reticle exists locally. The 0p5x0p5 board hasn't been run.",
    changes:[{ch:2, t:"new card: plan moved from the old 74-pad mezzanine to the run 2 boards"}],
    stream:[
      {ch:2, by:"user", t:"It seems that you have found the COB from my wafer.space chip on board repo. I would like for you to use the versions that are currently used in run 2, as the pin 1 and everything are in more sensible locations."},
      {ch:2, by:"claude", t:"Done, and they are more sensible: land 1 and the QR are both bottom left on every run 2 board, so the die sits at 0° on the board. Results per board are in [section 5](plan.html#number). The images in this plan are regenerated from the 1x1 pairing. Not covered: `0p5x0p5`, and any run 2 reticle GDS."},
    ]},

  {id:"PIN_ONE", title:"Pin 1 and direction — QR corner, counter-clockwise", status:"resolved",
    state:"A convention, not a requirement placed on the GDS. Pad 0 is at the QR corner, counting counter-clockwise, and pad n goes to land n+1. On run 2 the QR sits at the land 1 corner, so the die is at 0° on the board.",
    changes:[{ch:1, t:"framing"}, {ch:2, t:"Q3 answered: convention only. Rule proved on run 2; the 180° mount no longer applies. Bonding PDF labelling fault found."}],
    stream:[
      {ch:1, by:"user", t:"Having a convention where we have a pin 1 and go in some direction would be ideal as a minimum requirement."},
      {ch:1, by:"claude", t:"The QR cell is bottom-left on all 37 shuttle designs and on eurosynth. Counting counter-clockwise from there matches your COB's numbering on 74 of 74 wires, by edge and order. It also showed that the wires drawn in `waferspace_default_padring_v0.2` are placeholders: only 4 of 74 end on a real pad. See [section 5](plan.html#number)."},
      {ch:2, by:"user", t:"Yeah, it's just a convention now. We've got to keep things light. We can't expect everybody to adhere to our standards. We have to keep our thing flexible enough to accommodate the people who don't wish to implement the whole stack."},
      {ch:2, by:"claude", t:"Decided: nothing goes into the GDS for this. The rule held on all three run 2 boards, and it was the best of about 590 pairings tried per board. Two things to watch. The rocket silk no longer marks pin 1 on run 2, and the die's top-right logo cell looks like a QR but isn't one.\n\nOne thing you should look at: the run 2 bonding PDFs label every pad with the net from the opposite side of the die. On EURO, the pad beside the QR says `bidir_PAD[26]`, while the GDS, the board and the slot config all say `clk`. Details are in [section 5](plan.html#number). I haven't changed that repo."},
    ]},

  {id:"DIE_KIT", title:"Die kit — GDS to footprint, symbol and 3D stand-in", status:"info",
    state:"Prototype runs on eurosynth, WSLG and HZ80, with and without labels. STEP and the overrides file aren't built.",
    changes:[{ch:1, t:"framing"}, {ch:2, t:"run on HZ80 as well; generated footprints are now marked board_only"}],
    stream:[
      {ch:1, by:"user", t:"Likely a tool that takes the GDS and some other metadata and creates the footprint in KiCad. Because we're effectively creating a symbol for the schematic, it would help to extract the net names to create the symbol, and ideally generate a stand-in 3D model."},
      {ch:1, by:"claude", t:"Built as a prototype: [proto_diekit.py](proto/proto_diekit.py). KiCad loads and plots what it writes, and thickness is assumed for now. Pictures are in [section 6](plan.html#kit)."},
    ]},

  {id:"KICAD_MODEL", title:"KiCad model — where the net lives", status:"resolved",
    state:"Decided for now: mechanical die with no copper, nets on the lands, one footprint per wire. Generated footprints are `board_only`, so the schematic doesn't flag them.",
    changes:[{ch:1, t:"framing"}, {ch:2, t:"Q1 answered: option C, for now. board_only clears the 73 to 75 parity warnings."}],
    stream:[
      {ch:1, by:"claude", t:"Three options are compared in [section 7](plan.html#board). With a mechanical die, the F.Cu and B.Cu Gerbers match your original board, per-wire data has a home, and 3D wires work. The current `examples/kicad` board uses copper die pads, which would plot as substrate copper."},
      {ch:2, by:"user", t:"Sure, let's just go ahead with that for now."},
      {ch:2, by:"claude", t:"Going with option C. On run 2, Gerbers for copper, silk, mask, paste and edge are identical on all three boards. Marking the generated footprints `board_only` removes all the schematic parity warnings. DRC still reports the 75 new footprints as having no library, which the real tool has to fix. `examples/kicad` needs regenerating to match."},
    ]},

  {id:"WIRE_GEN", title:"Generating wires — like a zone fill", status:"open",
    state:"Lean: you set rules and per-pad exceptions, and geometry is always calculated. Works on all three run 2 boards. Q2 is still open, and the land bond point is a new question.",
    changes:[{ch:1, t:"framing"}, {ch:2, t:"proved on three boards; regenerating from the board's own type data works. New question Q8: where a wire ends on a land."}],
    stream:[
      {ch:1, by:"user", t:"Once those are satisfied, the wire locations of the from and to, from the chip to the board, should be able to be generated automatically."},
      {ch:1, by:"claude", t:"They can: [proto_assemble.py](proto/proto_assemble.py) ran on a copy of your board, with 74 wires, 56 `STD25` and 18 `PWR33` chosen by net name. Treating wires like a zone fill also fixes the die-moves-and-wires-stay-behind problem. Hand edits to generated coordinates would be lost, so exceptions must live as per-pad settings. See [section 8](plan.html#wires)."},
      {ch:2, by:"claude", t:"Q2 didn't get an answer, so it stays open. Run 2 adds evidence for it: editing a type in the board and regenerating changed only that type's wires, on all three boards.\n\nA new question came out of the rerun. The drawings put the wire end at 0.2, 0.5 and about 0.16 mm in from the land's inner end, depending on the board, so a single constant is only a guess. See [section 8](plan.html#wires)."},
    ]},

  {id:"WIRE_TYPES", title:"Wire types — like a pad type", status:"resolved",
    state:"Family, sizes, material, diameter, direction, with custom moves as the escape hatch. No bonding house to defer to, so the vocabulary comes from public sources. The library lives in the board file.",
    changes:[{ch:1, t:"framing"}, {ch:2, t:"Q4 answered: no bonding house and no definitions exist. Q5 answered: the board file. JEDEC 4-point added to the bench."}],
    stream:[
      {ch:1, by:"user", t:"This should be very reminiscent of how one would create a type of pad. It can be through-hole, square, round, oval. There are likely only a certain number of shapes upon which a wire bond should theoretically be created, which someone could define to their suiting."},
      {ch:1, by:"claude", t:"The analogy holds, and your 5 profiles already fit it. Public sources point to a few families (triangular, trapezoidal, M-shaped), and Altium manages with five settings and no presets. Machine loop names belong to bonder vendors and I found no public list, so your bonding house has the final word. Try the [loop bench](plan.html#types)."},
      {ch:2, by:"user", t:"We have no bonding currently, we don't even define them. If you are able to look online and see if there are any conceived definitions of what this even means, are there any conventions? Again, none of us really know anything, so we're making it up as we go along. If at any point you find something that relates, go ahead and let us know."},
      {ch:2, by:"claude", t:"Searched, and it's in the new [section 10](plan.html#exist). There's no single standard for describing a bonding design. The nearest is JEDEC JESD59, whose 4-point shape our moves string can already write. Europractice publishes concrete wire rules that I ran against your boards. Vendor loop names like Q, S and M are real, but I found no public definition of them. I'll keep flagging things like this as they turn up."},
      {ch:2, by:"user", t:"Ideally this actually exists in the KiCad PCB file itself. This will be a native feature."},
      {ch:2, by:"claude", t:"I tested that on KiCad 10.0.0. A footprint holding one field per type survives load and save, and regeneration reads from it. Board properties get wiped by KiCad's sync, and any token of our own stops the board loading. So the board file works today, using ordinary objects. What \"native\" should mean beyond that is the new Q6, on the card below."},
    ]},

  {id:"NATIVE", title:"Native in KiCad — what the board file can hold", status:"open",
    state:"Lean: hold the library in a footprint now, because it works in KiCad 10 today. Write up a real wire object once our fields settle, and take that to the KiCad developers.",
    changes:[{ch:2, t:"new card, from your Q5 answer and the KiCad 10 storage test"}],
    stream:[
      {ch:2, by:"claude", t:"KiCad 10 has no wire bond object. Its Python API has no bond-related names, and the pad properties don't include one. Wishlist item [#2272](https://gitlab.com/kicad/code/kicad/-/issues/2272) is closed, but I found no sign that anything was built. A real object would need a change to KiCad's parser, which has to come from upstream or a fork. A plugin can't add it. See [section 9](plan.html#types)."},
    ]},

  {id:"CONVENTIONS", title:"Existing conventions — what we can borrow", status:"open",
    state:"No single standard exists. Borrow JEDEC shapes, common wording and Europractice's numeric rules, each labelled with where it came from. Lean: use the numeric rules as default warnings.",
    changes:[{ch:2, t:"new card, from your request to report anything related"}],
    stream:[
      {ch:2, by:"claude", t:"Against Europractice's rules, your geometry mostly passes: lengths are 1.8 to 3.1 mm against a 6 mm limit, and nothing crosses. Two things get flagged. Four wires on the 1x0p5 board reach 45.4° against a 45° limit. And `PWR33`, the type I invented, is 33 µm wire, which their table pairs with at least a 70 µm pad, while every pad here is 60 µm. They're one assembly house's rules, not yours. See [section 10](plan.html#exist)."},
    ]},

  {id:"OUTPUTS", title:"Outputs — generated, one way only", status:"info",
    state:".wb.svg, bondlist, DXF, STEP and PDFs come from KiCad. The rotated-die blocker probably doesn't apply on run 2, which is untested.",
    changes:[{ch:1, t:"framing"}, {ch:2, t:"run 2 dies are at 0° on the board, so the blocker looks avoidable"}],
    stream:[
      {ch:1, by:"claude", t:"`wbx.rd` accepts only an unrotated die, and real dies on your COB mount at 180°, so the reader has to change before this board can export. See [section 10](plan.html#out)."},
      {ch:2, by:"claude", t:"Run 2 changes this: every die is at 0° on the board, so the exporter wouldn't need to write a rotated die. That's inferred. `wbx.py` wasn't run on these boards, and the old 74-pad board still has the limit. Section numbers moved by one this chapter: outputs is now [section 11](plan.html#out)."},
    ]},

  ],

  questions: [
    {id:"Q1", card:"KICAD_MODEL", ch:1, status:"answered", ach:2, q:"Should die pads be mechanical, with nets only on the lands?", answer:"Yes, for now: option C."},
    {id:"Q2", card:"WIRE_GEN", ch:1, status:"open", q:"Should wires be regenerated like zone fills, with coordinates never edited?"},
    {id:"Q3", card:"PIN_ONE", ch:1, status:"answered", ach:2, q:"Do pad numbers go into the GDS too, or stay convention plus sidecar?", answer:"Convention only, kept light and flexible for people who don't implement the whole stack."},
    {id:"Q4", card:"WIRE_TYPES", ch:1, status:"answered", ach:2, q:"What loop names does your bonding house use?", answer:"None. There is no bonding yet and nothing is defined. Use public sources, and report anything related that turns up."},
    {id:"Q5", card:"WIRE_TYPES", ch:1, status:"answered", ach:2, q:"Does the type library live in a project file?", answer:"No. Ideally it lives in the KiCad PCB file itself, as a native feature. Q6 asks what native should mean next."},
    {id:"Q6", card:"NATIVE", ch:2, status:"open", q:"What should \"native\" mean next: types held in ordinary KiCad objects, or a change to KiCad itself?"},
    {id:"Q7", card:"CONVENTIONS", ch:2, status:"open", q:"Should Europractice's published rules be our default wire checks?"},
    {id:"Q8", card:"WIRE_GEN", ch:2, status:"open", q:"Where on a land should a wire end by default?"},
  ],

  actions: [
    {id:"ACT-KIT", ch:1, status:"proposed", what:"Turn the die kit prototype into a tool: overrides file, partial data report, STEP, footprint library cleanup.", files:["proto/proto_diekit.py"]},
    {id:"ACT-WIRES", ch:2, status:"proposed", what:"Wire generator that is safe to rerun and keeps overrides. Measures die rotation from the board. Regenerate `examples/kicad` to match option C.", files:["proto/proto_assemble.py", "proto/proto_verify.py"], waiting:["Q2","Q8"]},
    {id:"ACT-TYPES", ch:2, status:"proposed", what:"Wire type library held in a `WBLIB` footprint in the board: families including JEDEC 4-point, assignment rules.", files:["proto/proto_assemble.py"], waiting:["Q6"]},
    {id:"ACT-CHECKS", ch:2, status:"proposed", what:"Wire checks with labelled limits: length, angle from pad normal, crossings, pad size against wire diameter. Per-board limits from `wire_max_mm`.", files:["proto/proto_pincheck.py"], waiting:["Q7"]},
    {id:"ACT-EXPORT", ch:2, status:"proposed", what:"KiCad board to `.wb.svg`, bondlist and DXF. Try run 2 first, where the die is at 0°. Render in the SVG.", files:["../../wbx.py"]},
    {id:"ACT-PANEL", ch:1, status:"proposed", what:"KiCad plugin with a wire type picker and a Regenerate button."},
    {id:"ACT-SILICON", ch:2, status:"proposed", what:"One die through to a bonded part, then compare measured loops against the types. Needs a bonding partner, which doesn't exist yet."},
    {id:"ACT-PDFS", ch:2, status:"proposed", what:"In `ws-bonding-diagrams`: fix pad names being half a ring off in the run 2 PDFs, then regenerate them. Outside this repo; your call."},
  ],
  phases: [],

  plan: "GDS owns the die, KiCad owns the assembly, and everything else is generated. A die kit turns a GDS into a footprint, symbol and 3D stand-in, using a light QR-corner counter-clockwise convention that third parties can ignore, with net names as an optional upgrade. On the run 2 COBs the die sits at 0° on the board with the QR at land 1. The die is mechanical and nets live on the lands. Wires are regenerated like zone fills from pad, land and a wire type, and the type library lives in the board file as fields on a footprint. Exports run one way, from KiCad to `.wb.svg`, bondlist, DXF and STEP. There's no bonding partner yet, so vocabulary and limits are borrowed from labelled public sources.",
  planChanges: [
    {ch:1, t:"first framing of the lifecycle, with prototype results"},
    {ch:2, t:"moved to the run 2 COBs; option C and the convention decided; type library moves into the board file; conventions surveyed; Q6, Q7 and Q8 added"},
  ],
};
