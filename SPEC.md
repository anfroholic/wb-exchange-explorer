# wirebond.svg specification, v0.1 draft

This describes what the prototype in `wbx.py` writes and reads. Fields marked *proposed* are not implemented.

## File extension

A wirebond.svg file uses the extension `.wb.svg`, for example `example.wb.svg`. The `.svg` ending lets any browser or SVG viewer open it, and `.wb` marks it as a wirebond.svg file and not a plain SVG.

## Rules

1. If it isn't drawn, it isn't in the file. `<metadata>` may hold only non-essential provenance.
2. One SVG user unit is 1 µm. Coordinates keep at most three decimals (1 nm). Parsers read the decimal text.
3. Namespace: `xmlns:wb="urn:wbx:0.1"`.
4. Names go in `wb:name`, never in `id`.
5. No scripts. Transforms are limited to translate, rotate and `scale(1 -1)`.
6. Minifiers are forbidden.

## Coordinates

File coordinates are SVG (y down). The die group's transform flips Y, so pad coordinates inside it are native GDS numbers, measured from the die outline's lower-left corner:

```xml
<g transform="translate(1750 4250) scale(1 -1)" wb:kind="die" ...>
```

A turned die adds a rotation between the two: `translate(x y) rotate(a) scale(1 -1)`.

The section view is a group with `wb:kind="stack"`, where z up is negative local y.

## Root attributes

`wb:version`, `wb:units="um"`, `wb:design`, `wb:rev`, `wb:rule-wire-gap`, `wb:rule-edge-clear`; draft `wb:rule-fid-clear`.

## Element kinds

| `wb:kind` | Element | Geometry carries | Attributes |
|---|---|---|---|
| `die` | `g` | Placement in `transform` | `name`, `gds-cell`, `pad-layer`; draft `place-tol`, `datums` |
| `outline` | `rect` | Die or substrate outline | `name` optional |
| `pad` | `rect` in die group | Opening, GDS coordinates | `name`, `net` |
| `land` | `rect` | Finger or down-bond target | `name`, `net`, `finish` |
| `wire` | `line` | Bond points; `stroke-width` is diameter | `name`, `from`, `to`, `profile`, `seq`, `tier`, `net`; draft `to-kind` |
| `stack` | `g` | Section view frame | none |
| `layer` | `rect` in stack | z is `-(y + height)`, thickness is `height` | `name`, `role`, `material`; draft `datum` (its top face) |
| `profile` | `g` with `polyline` | Control points at `ref-span` | `name`, `material`, `style`, `dir`, `moves`, `interp`, `ref-span`; draft `choice` |
| `fiducial` (draft) | `circle`, `rect`, `path` or `g`, on the board or in a die group | Shape; its reference point is the centre of its bounding box | `name`, `role`, `datum` |
| `fcf` (draft) | `g` | A drawn feature control frame and leader | `applies-to`, `char`, `tol`, `datums` |
| `zone` (draft) | `path`, two closed rectangles, even-odd | Inner and outer edge of the tolerance band | `applies-to`, `datums` |

Values: `role` is `substrate`, `attach`, `die` or `mold`. `style` is `ball-wedge` or `wedge-wedge`. `dir` is `forward` or `reverse`. `interp` is `polyline` or `spline`.

`wb:from` names a pad as `<die>.<pad>`, and `wb:to` names a land. `from` is always the first bond.

Draft, written by the app: a wire between two die has `wb:to` = `<die>.<pad>` and `wb:to-kind="die"`. A profile with `wb:choice="generic"` (the bonder picks, on purpose) or `wb:choice="undefined"` (nobody has said) has no material, diameter or moves. Its wires are drawn 20 µm wide, which is not a wire size, and the diameter and loop checks skip them.

Groups or shapes without `wb:kind` are derived decoration and are ignored by parsers.

## Loop moves

`wb:moves` is a list of `vertical/horizontal` steps, starting at the first bond. A vertical part is µm. A horizontal part is µm, or a percentage of the wire's horizontal span when written with `%`. After the last step, the wire runs straight to the second bond.

`180/0 30/12% -20/35%` rises 180 µm, rises 30 µm over 12% of span, falls 20 µm over 35% of span, then goes straight to the second bond.

## Validity

A file is valid when:

- each wire's first bond lies inside its named pad, and its second bond inside its named land
- the wire, pad and land nets agree
- `stroke-width` equals the profile's diameter
- the highest loop point is under the `mold` layer top
- loop clearance at the die edge meets `wb:rule-edge-clear`
- plan-view spacing between wires from different pads meets `wb:rule-wire-gap`
- no land is under the die or its attach fillet, which is half the attach layer's extra width
- with a placement tolerance, the forms present agree, each datum is on an element, and every check above still passes with the die at the edges of its zone
- draft: each fiducial is inside its frame, and no land or wire comes within `wb:rule-fid-clear` of a board fiducial (F2, F3 below)

The checker also gives warnings and notes, which don't make a file invalid.

## Fiducials (draft)

A fiducial is a feature with a known position that a machine's camera can find. It finds two or more, compares where they are with where the file says, and corrects every bond position by that difference. A wire bonder does this twice: once for the die, from two eye points in the die's own artwork, to correct the first bonds; and once for the board, to correct the second bonds. [docs/primer/fiducials.html](docs/primer/fiducials.html) explains the background.

```xml
<!-- board frame: SVG coordinates -->
<circle cx="800" cy="5200" r="250" class="cu" wb:kind="fiducial" wb:name="F1" wb:role="align" wb:datum="B"/>
<circle cx="1450" cy="4600" r="150" class="cu" wb:kind="fiducial" wb:name="P1" wb:role="orient"/>

<g transform="translate(1750 4250) scale(1 -1)" wb:kind="die" wb:name="U1" ...>
  <!-- die frame: GDS coordinates -->
  <g wb:kind="fiducial" wb:name="QR" wb:role="align">
    <rect x="30" y="30" width="42" height="42" class="mark"/>
    ...
  </g>
  <path d="M2470,2470 L2330,2470 L2470,2330 Z" class="mark" wb:kind="fiducial" wb:name="TRI" wb:role="align"/>
</g>
```

| Part | Rule |
|---|---|
| Kind | `wb:kind="fiducial"`, for board marks and die eye points alike. |
| Frame | Set by where it sits. Inside a `die` group it belongs to that die and uses GDS coordinates, like a pad, so it moves with the die. Anywhere else it's on the board. |
| Shape | A `circle`, a `rect`, a `path` of straight segments only (`M L H V Z`, either case), or a `g` of those. A group carries the `wb:` attributes; its children carry none. |
| Reference point | The centre of the shape's bounding box, stroke ignored. For a circle, its centre. Nothing else sets it, so the point is always what's drawn. |
| `wb:name` | Unique within its frame. |
| `wb:role` | `align`, the default: a machine may fit to it. `orient`: a mark for people, such as a pin 1 dot or "the die's QR goes here"; no tool fits to it. |
| `wb:datum` | Optional. The same fiducial can be a datum for the placement tolerance and an alignment point. |
| Not in the file | Mask clearance around the mark, global versus local, and anything on the back of the board. These are for pick and place, which reads Gerbers and position files, and KiCad already carries them. |

`wb:rule-fid-clear` on the root is the least distance, in µm, from a board fiducial to any land or wire. Its value is ours, with no source behind it; the example uses 150.

### Checks

| Key | Check | Level |
|---|---|---|
| F1 | The board and each die have at least two `align` fiducials. If not, the bonding house picks its own. | Warning |
| F2 | A die fiducial is inside its die outline. A board fiducial is inside the substrate outline and not under a die or its attach fillet. | Error |
| F3 | No land or wire, in plan view, comes within `wb:rule-fid-clear` of a board fiducial's bounding box, or touches it. | Error |
| F4 | For each frame, the two `align` fiducials farthest apart, their spacing, and the lever ratio: the distance from their midpoint to the farthest bond they carry, over their spacing. The die's carry first bonds and the board's second bonds. Times the bonder's find error, the ratio is roughly the error at that bond. There's no limit until a bonding house gives us a find error. | Reported |
| F5 | A die's pair has the same shape and size and sits point-symmetric about the die centre, so a die turned 180° looks the same to them. | Warning |
| F6 | A die fiducial overlaps a pad that gets a wire. Fine for the first find, but the ball hides it from inspection or a re-teach. | Note |

F5 compares shape type and bounding box size, not the drawn geometry, so it can miss pairs that look alike.

### In and out

- **KiCad:** a board fiducial is a footprint with `wb_kind` `fiducial`, `wb_role` and any `wb_datum`, holding one unnumbered pad at the reference point. An `align` fiducial's pad has KiCad's fabrication property, `(property pad_prop_fiducial_glob)`, so it's marked as a fiducial in the Gerbers. The mask opening is widened by `wb:rule-fid-clear`. Only circles and rectangles map to a pad so far. Die fiducials stay with the GDS.
- **GDS:** there's no fiducial layer. The example puts its eye points in top metal (81/0), each named by a text label on 81/10. Real wafer.space dies have a QR code at bottom left and a different mark in the opposite corner, but no labels.
- **Out:** `wbx.py export` writes `<base>.fiducials.csv` with frame, name, role, datum and the reference point in the bond list's die-centred, y-up coordinates. The bonding house can teach from it.

## Placement tolerance (draft)

Pad, land and die coordinates are nominal. This draft adds one number: how far the die may sit from its nominal place on the board. It uses GD&T (ASME Y14.5) terms but only one control, a profile tolerance on the die outline, referenced to three datums:

- **A**, the top face of the substrate, marked with `wb:datum="A"` on its stack layer.
- **B** and **C**, two board fiducials, `<circle wb:kind="fiducial" wb:role="align" wb:datum="B">`, copper dots that the die attach and bond machines can also find.

A profile tolerance of 50 means the die's outline must lie in a band 50 µm wide, centred on the nominal outline. That limits shift and turn together: the example's 2.5 mm die still fits shifted 25 µm, or turned 1.16°. Note that the band holds the sawn edge, so variation in the die's sawn size uses some of it up.

The example carries the same rule three ways, so they can be compared. The checker reads any one of them and reports an error if two disagree.

| Option | In the file | For | Against |
|---|---|---|---|
| A. Attributes | `wb:place-tol="50" wb:datums="A B C"` on the die group | Smallest; a tool reads one number | Not drawn, so it breaks rule 1; only hover text shows it |
| B. Feature control frame | `<g wb:kind="fcf" wb:char="profile" wb:tol="50" wb:datums="A B C">` with the frame, leader and all-around circle drawn inside it | Drawn the way an assembly house reads a drawing; names its datums | A notation to learn; `wb:char` could grow into all of GD&T |
| C. Drawn zone | `<path wb:kind="zone">`, the band itself at true scale | Rule 1 at its purest: the band is the data, and it can be checked by eye against the lands | Thin at full view (50 µm on a 6 mm board); the width has to be worked out from geometry |

Recommendation: keep B as the single place the number lives, and draw C from it as decoration without `wb:kind`. Drop A. That keeps one source of truth, and it's still drawn.

### What the checker does with it

The checker assumes the bonder finds the die by vision, as automatic bonders do: first bonds follow the die, and second bonds follow the lands. It moves the die to ten places at the edge of its zone (eight shifts of half the width, and the largest turn each way) and runs every check again. `wbx.py place` finds how far the die can actually go.

For the example:

| Bonder | Largest shift | Largest turn | First to fail |
|---|---|---|---|
| Finds the die | 34.9 µm | 2.30° | W12, a ground down bond, at 39 µm clearance over the die edge |
| Doesn't, bonds where programmed | 10.1 µm | | W08's 33 µm ball leaves the VBUS pad |

The short down bonds fail first, because their lands are 150 µm from the die. The 50 µm band leaves 47 µm of edge clearance in the worst case, against a 40 µm rule. These limits come only from the checks above. The app's other rules, such as wire angle and length, aren't in `wbx.py`, so they may be tighter. A bonder's vision capture range also isn't checked; nobody here has that number yet.

## Proposed

- fiducial `match`, linking an `orient` mark to the die fiducial that points at it, for example `wb:match="U1.QR"` on a pin 1 dot
- wire `via` for stitch chains, and `security-bump`
- profile `min`, `max`, `vendor-name`, `certified-by`, and angle units in moves
- `keepout` with a height
- die `stack-layer` for multi-die stacks
- a model hash on the root to detect editor changes
- tolerances on other values, such as die thickness and bondline, which move loop heights, and a `none` versus `unspecified` distinction, following open.cob.json
- mappings to the JEDEC 4-point and 5-point bond wire models
