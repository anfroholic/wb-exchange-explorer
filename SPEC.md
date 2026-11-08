# WBX specification, v0.1 draft

This describes what the prototype in `wbx.py` writes and reads. Fields marked *proposed* are not implemented.

## Rules

1. If it isn't drawn, it isn't in the file. `<metadata>` may hold only non-essential provenance.
2. One SVG user unit is 1 µm. Coordinates keep at most three decimals (1 nm). Parsers read the decimal text.
3. Namespace: `xmlns:wb="urn:wbx:0.1"`.
4. Names go in `wb:name`, never in `id`.
5. No scripts. Transforms are limited to translate, rotate and `scale(1 -1)`.
6. Minifiers are forbidden.

## Coordinates

File coordinates are SVG (y down). The die group's transform flips Y, so pad coordinates inside it are native GDS numbers:

```xml
<g transform="translate(1750 4250) scale(1 -1)" wb:kind="die" ...>
```

The section view is a group with `wb:kind="stack"`, where z up is negative local y.

## Root attributes

`wb:version`, `wb:units="um"`, `wb:design`, `wb:rev`, `wb:rule-wire-gap`, `wb:rule-edge-clear`.

## Element kinds

| `wb:kind` | Element | Geometry carries | Attributes |
|---|---|---|---|
| `die` | `g` | Placement in `transform` | `name`, `gds-cell`, `pad-layer` |
| `outline` | `rect` | Die or substrate outline | `name` optional |
| `pad` | `rect` in die group | Opening, GDS coordinates | `name`, `net` |
| `land` | `rect` | Finger or down-bond target | `name`, `net`, `finish` |
| `wire` | `line` | Bond points; `stroke-width` is diameter | `name`, `from`, `to`, `profile`, `seq`, `tier`, `net` |
| `stack` | `g` | Section view frame | none |
| `layer` | `rect` in stack | z is `-(y + height)`, thickness is `height` | `name`, `role`, `material` |
| `profile` | `g` with `polyline` | Control points at `ref-span` | `name`, `material`, `style`, `dir`, `moves`, `interp`, `ref-span` |

Values: `role` is `substrate`, `attach`, `die` or `mold`. `style` is `ball-wedge` or `wedge-wedge`. `dir` is `forward` or `reverse`. `interp` is `polyline` or `spline`.

`wb:from` names a pad as `<die>.<pad>`, and `wb:to` names a land. `from` is always the first bond.

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

## Proposed

- `fiducial` elements for machine alignment
- wire `via` for stitch chains, and `security-bump`
- profile `min`, `max`, `vendor-name`, `certified-by`, and angle units in moves
- `keepout` with a height
- die `stack-layer` for multi-die stacks
- a model hash on the root to detect editor changes
- tolerances and a `none` versus `unspecified` distinction, following open.cob.json
- mappings to the JEDEC 4-point and 5-point bond wire models
