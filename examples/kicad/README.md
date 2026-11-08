# KiCad example

The same assembly as `../example.wb.svg`, as a KiCad 10 board. It's the input a future KiCad to WBX importer would read. No importer exists yet. For now `../make_kicad.py` generates these files from the `.wb.svg`, so don't hand-edit them if you plan to regenerate.

KiCad has no bond wire, so this board uses a convention. KiCad preserves that data but doesn't interpret it.

There's no schematic, only `.kicad_pro` and `.kicad_pcb`. Nets exist only as pad assignments, so there's no ERC, and schematic parity checks and Update PCB from Schematic can't be used.

## Units

KiCad mm = SVG µm / 1000, with no offset. Both are y-down. Text values in `wb_` board properties stay in µm, as `wb_units` says.

## Mapping

| WBX | KiCad object | Where the data is |
|---|---|---|
| Die | Footprint `U1`, anchored at the GDS origin | `(at)` is the translate; `wb_gds_cell`, `wb_pad_layer` |
| Die outline | `fp_rect` on `F.Fab` in `U1` | Width and height |
| Pad | `smd rect` pad on `F.Cu` in `U1` | Number is the GDS pad name; local position is `(gds_x, -gds_y) / 1000`; size is the opening; net |
| Land | One-pad footprint `L1`..`L20`, anchored at the land centre | Pad size and net; `wb_finish` |
| Wire | Padless footprint `W01`..`W21`, anchored at the first bond | One `fp_line` on `Wirebond`, whose end is the second bond and whose width is the diameter; `wb_from`, `wb_to`, `wb_profile`, `wb_seq`, `wb_tier`, `wb_net` |
| Substrate outline | `gr_rect` on `Edge.Cuts` | Name in `wb_substrate_name` |
| Design, rev, rules | Board properties | `wb_design`, `wb_rev`, `wb_rule_wire_gap`, `wb_rule_edge_clear`, plus `wb_version`, `wb_units` |
| Loop profile | Board properties | `wb_profile_<i>_name`, `_material`, `_d`, `_style`, `_dir`, `_moves`, `_interp`, `_ref_span` |
| Stack layer | Board properties | `wb_stack_<i>_name`, `_role`, `_material`, `_z`, `_t`, `_x`, `_w` |

Each die, land and wire footprint has `wb_kind` set to `die`, `land` or `wire`. A reader should select on that, and ignore other footprints.

## For anyone reading the file

- `Wirebond` is a display name. The layer table says `(39 "User.1" user "Wirebond")`, and objects say `(layer "User.1")`. Look the name up in the table.
- KiCad re-sorts footprints and board properties when it saves. Sort wires by `wb_seq`; `<i>` keeps the profile and stack order.
- Apply the footprint's `(at x y angle)` to local coordinates. A rotated wire keeps its original local coordinates.
- A die rotated in KiCad has no equivalent in `wbx.rd`, which accepts only a translate and flip.

## Keep the project file

Board properties are repeated in `text_variables` in `example.kicad_pro`, and the two must match. KiCad's `BOARD.SynchronizeProperties()` replaces the board's table with the project's, so an empty project table erases every board property. The generator writes both tables.

To change a board value in the GUI, use Board Setup > Text Variables. The title block shows `${wb_design}` and `${wb_rev}` from the same table.

## What KiCad understands

| KiCad does | KiCad doesn't |
|---|---|
| Keep pad nets, draw the ratsnest, and check copper clearance | Know a wire connects a pad to a land |
| Keep the custom properties and let you edit them | Validate them, or check them against pads and lands |
| Draw and plot wires on `Wirebond` | Run DRC on wires, or apply the wire gap and edge clearance rules |
| Keep the profile and stack values as text | Use them; there are no 3D wires, loops or die heights |

## Expected behaviour

- **DRC:** 0 violations and 23 unconnected items. Those are real from KiCad's point of view, because wires aren't copper. A net with one pad and one land gives one line, so the 2 VBUS wires share 1. GND gives 7, and 3 of those run between die pads and match no wire.
- **Moving items:** moving `U1` or a land leaves the wires behind, and nothing in KiCad flags it. `wbx check` will, once an importer has produced a `.wb.svg`.
- **Gerbers:** die pads are on `F.Cu`, so they plot as substrate copper. Don't send this board's outputs to a fab as they are.
