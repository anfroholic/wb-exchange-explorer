# Wire Bond Bench

A browser app for trying ways to build a wire bonded assembly for KiCad. It reads a GDS, a `.kicad_pcb` and a `.kicad_mod`, and everything runs in the page: no install, no build step, and no file leaves the browser.

Open `app/index.html` in Chrome or Edge. It also works from any static web host. Your last session is kept in that browser until you press **Start over**.

## Using it

1. **Substrate.** Drop a footprint, or a board and pick the footprint in it. Add the board's `.kicad_pro` and `.kicad_sch` to carry its design rules and schematic through to the export.
2. **Die.** Drop a GDS, which gives the artwork, size, pad positions and any net names. Or use a second footprint, from a file or from the same board.
3. **Placement.** The die is centred on the paddle, or the middle of the lands if there's no paddle, at the rotation with the least wire.
4. **Regimes.** Each way of pairing pads to lands is measured side by side. Hover to preview one, and click to use it.
5. **Put it in KiCad.** Write the assembled board, a die footprint, a die kit, a bondlist or a `.wb.svg` bond diagram.

| Key | Action |
|---|---|
| V, W, M | Select, add wires, move the die |
| R, F | Turn the die 90°, fit the view |
| Delete, Esc | Delete the selected wires, cancel and clear the selection |
| Ctrl+click, Shift+click | In the Wires list: add or remove a wire, select a range. Ctrl+Shift+click adds a range. Ctrl+click a wire in the plan or 3D view adds or removes it too |
| Ctrl+A, Up, Down | In the Wires list: select every wire, move the selection, Shift to stretch it |
| Scroll, right-drag | Zoom, pan |

With the Wire tool, click a pad and then a land. With Select, click a wire and drag its white squares to move an end. Wires you place or edit are pinned, so they survive changing regime. Pairs are kept when the die moves, and the geometry follows.

With several wires selected, the panel on the right sets their type, pinned state and ends all at once, and shows "mixed" where they differ. Deleting several asks first, since there's no undo. The selection isn't saved, and it clears when a regime replaces the wires.

Rest the pointer on any control or value, or reach it with Tab, and a short note says what it is, what changing it affects and its unit. A disabled control says why. An ⓘ gives a longer note, such as what a regime needs; click it on a touch screen. Esc, scrolling or a click puts the note away. The plan and 3D views keep only their own hover tip, so nothing gets in the way of dragging.

Every note lives in `js/tips.js`, in one table keyed by what an element already carries: `data-bind="x"` reads `bind:x`, `data-act="x"` reads `act:x`, and anything else names its key in `data-tip`. Notes about a rule read its value, tier and source from `js/rules.js` when shown, so they can't drift from it. Add a note there rather than a `title`, so there's only one tooltip.

## Several die

**Add another die** under Die gives a new slot for a GDS or footprint. Die are named D1, D2 and so on, and clicking a die, its pad or its row selects it, so Placement and the regimes act on that one. Nothing assumes an arrangement: die can be any size and sit side by side or stacked, off centre or overhanging.

- **Sits on** sets where the die's underside is: the board, the top of another die, or a custom height in µm. On another die, the height is that die's top plus the attach layer, and it follows when that die gets thicker, moves or turns.
- **Wires** go from a pad to a land or to a pad on another die. With the Wire tool, click one then the other, in either order. That order says nothing about which end is bonded first. New die-to-die wires get the default type like any other.
- **Regimes** run for the selected die against the lands. Net names also pair a pad with a pad on another die when no land carries its net. From the board covers every die. A regime only replaces its own die's wires, and pinned wires stay.
- **Checks** cover every die. Die edge clearance is measured at each die a wire crosses, and against the underside if it runs below an overhang. New checks: die in the same space, a bonded pad under a higher die, and the top of the stack under the glob top. Crossings between wires at different levels are compared by loop height, and generic and undefined wires there are counted as not compared.
- **In KiCad** each die is its own footprint, with its reference as its name. `wb_sits_on` and `wb_bottom_um` are written only for a die off the board. A die-to-die wire has `wb_to` = `D1.7` and `wb_to_kind` = `die`. The bondlist gains `to_kind` and `origin` columns once there are several die. One die writes exactly what it did before.

## Regimes

| Regime | Needs | Rule |
|---|---|---|
| Number rule | Pin 1 and a direction | Pad n goes to land n + offset |
| Shortest ring | Nothing but geometry | Angular order around the die, at the rotation with the least wire, without crossing |
| Net names | Named pads and lands | Same net. A land net `pad_k` means die pad k, counted from zero |
| From the board | `wb_kind` wire footprints | The pairs already in the board |
| Drawn lines | Lines on `Cmts.User` in the substrate | Each end snapped to a pad and a land within 0.15 mm |
| By hand | Nothing | You place every wire |

## Generic and undefined wires

Two types leave the wire and loop to whoever bonds it. Both say only that this pad goes to this land.

- **Generic: bonder's choice** is a decision: someone chose to let the person at the machine pick the wire and loop. Every new wire is generic, under any regime and with the Wire tool.
- **Undefined: not specified** means nobody has said anything. A board whose wires name no readable type reads as undefined, and a session saved before generic existed keeps its undefined wires and default.

Nothing depends on anyone using this app's other types, such as STD25 or PWR33: they're there to opt into, in the Types tab, which marks the current default and sets the rules.

Both follow one path, from `choicePath` in `model.js`: a single shallow arc from pad to far end, a parabola over the straight line between the two bond heights. It's lifted just enough to level off at the higher end and pass a tube's width over each die edge it leaves, and at least 4% of the span. It has no vertical rise, flat top or kink, so it never passes for a real loop, and it bends the same way all along, so it renders cleanly. Generic is drawn solid along it and undefined dashed, in neutral greys, in plan, 3D and the loop view. The loop view gives no clearance or peak for either, and lengths are marked ≈ as the straight pad to land estimate.

Checks treat the two the same. Checks on the pairing, ends and die geometry still run: crossings, gaps, angle, reach, pad opening, pad pitch, lands, nets and bonds on target. Checks that need a wire size or loop say "not checked": die edge clearance, loop height, glob top and every rule given per wire diameter. "Wires left to the bonder" counts both, and says how many of each.

In KiCad, each is written with `wb_type` = `GENERIC` or `UNDEFINED` and a zero-width line, solid for generic and dashed for undefined. Its 3D model is a 20 µm neutral tube along the same arc. That size is only so it can be seen: it isn't a wire size, and the `WBLIB` field says so. `WBLIB` gets a plain-words `wb_type_GENERIC` or `wb_type_UNDEFINED` field only when a wire uses that type, and the bondlist leaves `peak_um` empty. Neither type can be deleted or renamed, or given a spec by a board's library. Wires of a deleted type take the default, and deleting the default makes generic the default.

## What it writes

The export follows the model in `planning/wire_bond_lifecycle`. The die is mechanical with no copper, nets stay on the lands, each wire is one footprint, and the type library is a footprint holding one field per type. The rest of your board is unchanged, byte for byte.

| Item | KiCad object |
|---|---|
| Die | Footprint with `wb_kind` = `die`: outline on `F.Fab` and `F.CrtYd`, artwork image, filled `F.Fab` pad rectangles, a 3D model |
| Pad number and net | `F.Fab` text over the pad rectangle, as `<number> <net>` |
| Wire | Footprint with `wb_kind` = `wire`: a line on the first unused user layer, a 3D model, and `wb_from`, `wb_to`, `wb_type`, `wb_net`, `wb_seq` |
| Wire types | Footprint `WBLIB` with `wb_kind` = `type_library` and a `wb_type_<name>` field per type |

Loading an exported board brings the die, wires and types back, and exporting again replaces them.

### The bond diagram

**Bond diagram (.wb.svg)** writes the same assembly in the wirebond.svg format from [SPEC.md](../SPEC.md). It's a true-scale drawing of the bond area that any browser opens, with hover text on every wire, pad, land and layer, and `python wbx.py check` reads it. Nothing reads it back into the app: it's a handoff file.

The **Diagram** view, next to Plan and 3D, shows that file as you work. It redraws a moment after any change, such as turning the die, editing a wire or a type, or changing a DRC rule, so you can keep an eye on it. **Drawing** shows it as a browser would: scroll to zoom, drag to pan, Fit (F) to see it whole, and hover a wire, pad, land or layer for its details. **Code** shows the SVG text with the `wb:` attributes (the data) highlighted, and the die artwork's base64 image shortened so it doesn't bury the rest. **Both** puts them side by side. **Copy code** and **Download .wb.svg** give the whole file, byte for byte what the menu's export writes.

- The board is cropped to the die, lands and wires, and shifted to start near 0. Coordinates are µm.
- Each die is a group named by its reference, flipped so its pads read as GDS numbers from the die's lower-left corner. A turned die adds `rotate()` to that group.
- Wires are named `W01` onward, as in the board. `wb:from` is `D1.<pad>` and `wb:to` is the land as the board names it, or `D1.<pad>` with `wb:to-kind="die"` for a die-to-die wire.
- The side view stacks the substrate, then each die's attach and die, then the glob top when that rule is on. Thicknesses are the assumed ones under Placement. A footprint substrate is taken as 800 µm, as in the assembled board.
- Generic and undefined wires get a profile with `wb:choice` and no loop. They're drawn 20 µm wide, dashed for undefined, and the checker skips their loop checks.
- The die artwork, ball marks, land net labels and the side view's wires are decoration with no `wb:kind`.

`wbx.py` reads one die at 0°. A turned die or several die are written correctly but aren't read by it yet.

## What KiCad 10 taught us

Each of these was found by loading files in KiCad 10.0.0, and each would otherwise cost someone time:

- A pad with no copper loses its number and pin function when KiCad loads it. That's why pad numbers are Fab text.
- A footprint's image is positioned in board coordinates in a `.kicad_pcb`, unlike every other item in a footprint. It moves with the footprint, but it doesn't turn with it.
- A board won't load if its layer table doesn't start with `F.Cu`.
- Design rules live in `.kicad_pro`. A board copied without one gets KiCad's defaults, which on the 1x0p5 COB meant 1381 DRC items instead of 22.
- KiCad draws a zero-width line at 0.1 mm and writes that width back when it saves. So a generic or undefined wire's line width means nothing, and `wb_type` is what counts.

## Limits

- Pad finding ranks layers by how regular their boxes are around the die edge. It's checked on eurosynth and the generated example, not on other PDKs. You can pick the layer, set size limits and correct single pads.
- Die thickness and attach height are assumed, because a GDS doesn't hold them.
- A rotated die loses its artwork in the board, because KiCad doesn't turn the image. The 3D model keeps it.
- Crossings and wire gaps are checked in plan view and ignore loop height.
- The limits in Checks come from the **DRC rules** panel, opened from the top bar or the Checks tab. Each default is labelled Standard, Vendor guide, Rule of thumb or Placeholder, and a tripped placeholder only warns. Rules can be changed, switched off, reset, or exported and imported as JSON, and they save with the session. Some, such as the keepout to tall parts, aren't enforced yet and say so. [`docs/wire_bond_design_rules.svg`](../docs/wire_bond_design_rules.svg) draws every rule, and [`docs/wire_bond_design_rules_sources.md`](../docs/wire_bond_design_rules_sources.md) says where each number comes from. [`docs/primer/wire-bonding-primer.html`](../docs/primer/wire-bonding-primer.html), linked from the top bar, explains them for someone new to bonding. They're for comparison, not sign-off.
- OASIS isn't read. Nothing here has been bonded.
- Tested in Chrome only. Reading `.gz` needs `DecompressionStream`, which current Chrome, Edge, Firefox and Safari have.

## Files

| File | Holds |
|---|---|
| `js/gds.js` | GDS parser, pad finding, label reading, artwork rasteriser |
| `js/kicad.js` | S-expression parser, footprints and boards, lands, footprint as die |
| `js/model.js` | Placement, loops, regimes, checks |
| `js/rules.js` | The DRC rule table: defaults, tiers and sources. `make_rules_svg.py` draws the spec sheet from it |
| `js/export.js` | KiCad writers, `.wb.svg` writer, VRML, zip |
| `js/view.js` | Plan, 3D and loop drawings |
| `js/tips.js` | The note for every control and value, and the tooltip that shows it |
| `js/app.js` | Session, file loading, panels |
| `js/samples.js` | Bundled examples, generated by `make_samples.py` |

## Tests

```sh
pip install pytest playwright
python -m pytest tests/test_app.py
```

These drive the app in Chrome and give its output to `kicad-cli`. KiCad and real-chip tests skip when `kicad-cli` or the sibling `eurosynth` and `chip-on-board-wire-bonded-pcbs` repos are missing.
