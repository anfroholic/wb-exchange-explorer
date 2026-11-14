# wirebond.svg: a viewable wire bond exchange format

wirebond.svg is a restricted SVG profile for describing a wire bonded assembly. A `.wb.svg` file opens in any browser as a true-scale bonding diagram, and tools read the same file as data.

**Status: prototype, v0.1 draft.** All example data is illustrative. Nothing here has been run through a real bonder or offline programming tool.

**Name:** this project is called wirebond.svg, and its files use the extension `.wb.svg`. It was previously called WBX, and the code still uses that name (`wbx.py`, the `wbx` package and `urn:wbx:0.1`) until it is renamed. The repository also still has its old name, `wb-exchange-explorer`.

![Example bonding diagram](docs/example.png)

## The idea

- The picture is the data: 1 SVG unit = 1 µm, `stroke-width` is wire diameter, `rect` is a pad opening.
- Height lives in a drawn section view, where a rectangle's height is that layer's thickness.
- Everything else sits on drawn elements as `wb:` attributes.
- Loop shapes are parametric, so one profile fits any wire span.
- Wires reference pads by name, and a checker catches geometry that has drifted.

See [SPEC.md](SPEC.md) for the format and [docs/report.md](docs/report.md) for the design reasoning and prior-art survey.

New to wire bonding? Open [docs/primer/wire-bonding-primer.html](docs/primer/wire-bonding-primer.html) in a browser. It explains what bonding is, the words for it, and why each design rule is what it is. [docs/primer/fiducials.html](docs/primer/fiducials.html) covers how pick and place machines and wire bonders find the board and the die, and how wirebond.svg describes fiducials.

## Wire Bond Bench

Open `app/index.html` to try ways of building a bonded assembly on your own files. It reads GDS, `.kicad_pcb` and `.kicad_mod`, compares ways of generating wires, and writes back to KiCad. See [app/README.md](app/README.md).

## Try it

```sh
pip install lxml ezdxf gdstk pytest
python wbx.py check examples/example.wb.svg
python wbx.py place examples/example.wb.svg   # how far the die can move before a check fails
python wbx.py export examples/example.wb.svg /tmp/example
python examples/make_example.py   # rebuilds the example from a generated GDS
python -m pytest
```

Open `examples/example.wb.svg` in a browser and hover over any wire, pad or layer.

## What works

| Path | State |
|---|---|
| GDS to `.wb.svg` | Pad extraction tested on a generated GDS; the assembly side is hard-coded in `examples/make_example.py` |
| App to `.wb.svg` | The app in `app/` writes one from any session. Its example passes `wbx.py check`; a turned die or several die aren't read by `wbx.py` yet |
| Parse and rewrite | Byte-identical on the example |
| Checks | Bond on pad, net agreement, wire diameter, loop against cap, die edge clearance, plan-view wire gap, lands clear of the die attach |
| Die placement tolerance | Draft: datums, a profile tolerance on the die in three trial forms, and every check rerun at the edges of the zone. See [SPEC.md](SPEC.md#placement-tolerance-draft) |
| Bondlist CSV and 3D DXF export | Generated; not loaded in a bonder tool |
| KiCad import and export | Not built |

Known limits of the prototype: one die, a fixed canvas size, µm and percent moves only (no angles), and a plan-view wire gap check that doesn't yet account for loop height.

## Handling files

Do not run `.wb.svg` files through SVGO or other minifiers. They convert shapes to paths and remove `id` values, which breaks parsing. Editing in Inkscape, Illustrator or Figma is untested.

## Related work

[open.cob.json](https://github.com/MaxClerkwell/open.cob.json) is a JSON exchange format for chip-on-board wire bonding with a broader data model and working KiCad export. This project overlaps with it, and the report recommends contributing the viewable SVG form there rather than competing.
