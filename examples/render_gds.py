"""Render a GDS die to a true-scale PNG with an exact pixel-to-um mapping.

The picture is decoration for a .wb.svg. Nothing should ever read data back out of it.

    python render_gds.py example.gds -o example.die.png --layers "0/0=#c9ccd6,37/0=#72342b"

    python render_gds.py chip_top.gds.gz --cell chip_top -o chip.png --um-per-px 1 \
        --layers "81/0=#cdc16b,37/0=#72342b"

Mapping, with s = um per pixel and (x0, y0) the lower-left of the die box. Pixel (col, row)
counts from the top-left corner and covers the square

    x_um in [x0 + col*s, x0 + (col+1)*s]
    y_um in [y0 + (H-row-1)*s, y0 + (H-row)*s]

The image is W*s by H*s um. It equals the die box when s divides both die sides. Otherwise
pixels stay square and the image runs past the die's right and top edges by under one pixel.

Why the render shifts every layer instead of just framing the die box: KLayout centres its
pixels on whole device coordinates and snaps the view to whole pixels, so a target box alone
leaves shapes half a pixel off, and a die origin that isn't a multiple of s adds more. It also
pads non-matching aspect ratios. Moving the geometry to a box anchored at 0 avoids all of it.
Frames are off because a 1 px frame grows each shape by half a pixel per side.

Text is off because KLayout draws it at a fixed pixel size, which isn't true scale.
"""
import argparse, colorsys, json, math, os, tempfile, time
import klayout.db as kdb
import klayout.lay as klay
from PIL import Image, ImageChops, PngImagePlugin

Image.MAX_IMAGE_PIXELS = None  # we only open what we just rendered


def parse_layers(spec):
    "'81/0=#cdc16b,37/0=#72342b' -> [(81, 0, 0xcdc16b), ...], painted in that order"
    out = []
    for item in spec.split(","):
        ld, colour = item.strip().split("=")
        l, d = ld.split("/")
        out.append((int(l), int(d), int(colour.lstrip("#"), 16)))
    return out


def default_layers(ly, cell):
    "Every layer holding geometry, in number order, with evenly spaced hues. Rarely pretty."
    found = sorted((i.layer, i.datatype) for i in map(ly.get_info, ly.layer_indexes())
                   if not cell.bbox(ly.layer(i)).empty())
    out = []
    for k, (l, d) in enumerate(found):
        r, g, b = colorsys.hsv_to_rgb(k / max(len(found), 1), 0.5, 0.85)
        out.append((l, d, int(r * 255) << 16 | int(g * 255) << 8 | int(b * 255)))
    return out


def save_png(src, dst, info):
    "Re-encode KLayout's PNG: palette when lossless, deterministic, with provenance text."
    im = Image.open(src).convert("RGB")
    colours = im.getcolors(256)
    if colours:
        pal = im.quantize(len(colours))
        if ImageChops.difference(pal.convert("RGB"), im).getbbox() is None:
            im = pal
    meta = PngImagePlugin.PngInfo()
    meta.add_text("wbx-render", json.dumps(info, sort_keys=True))
    im.save(dst, optimize=True, pnginfo=meta)


def render(gds, out, cell=None, um_per_px=1.0, layers=None, outline_layer=None):
    t0 = time.time()
    ly = kdb.Layout()
    ly.read(gds)
    tops = ly.top_cells()
    if cell:
        c = ly.cell(cell)
        if c is None:
            raise SystemExit(f"no cell {cell!r} in {gds}")
    elif len(tops) == 1:
        c = tops[0]
    else:
        raise SystemExit(f"{len(tops)} top cells, choose with --cell: {[t.name for t in tops]}")
    t_read = time.time() - t0

    box = c.bbox(ly.layer(*outline_layer)) if outline_layer else c.bbox()
    if box.empty():
        raise SystemExit("nothing to render: empty die box")
    dbu, s = ly.dbu, um_per_px
    x0, y0, x1, y1 = box.left * dbu, box.bottom * dbu, box.right * dbu, box.top * dbu
    # 1e-6 stops float noise such as 2500/0.1 = 25000.000000000004 adding a pixel
    W, H = (math.ceil((v1 - v0) / s - 1e-6) for v0, v1 in ((x0, x1), (y0, y1)))

    chosen = layers or default_layers(ly, c)
    present = {(i.layer, i.datatype) for i in map(ly.get_info, ly.layer_indexes())}
    for l, d, _ in chosen:
        if (l, d) not in present:
            print(f"warning: layer {l}/{d} is not in {gds}")

    lv = klay.LayoutView()  # takes ownership of ly, so keep lv alive until the image is written
    lv.show_layout(ly, True)
    lv.clear_layers()
    for key, val in {"grid-visible": "false", "background-color": "#ffffff", "text-visible": "false",
                     "bitmap-oversampling": "1"}.items():
        lv.set_config(key, val)
    shift = kdb.DCplxTrans(-x0 - s / 2, -y0 - s / 2)  # see module docstring
    for l, d, colour in chosen:
        lp = klay.LayerProperties()
        lp.source = f"{l}/{d}"
        lp.fill_color = lp.frame_color = colour
        lp.dither_pattern = 0
        lp.width = 0
        lp.trans = [shift]
        lp.visible = True
        lv.insert_layer(lv.end_layers(), lp)
    lv.active_cellview().cell = c
    lv.max_hier()

    info = dict(cell=c.name, die_um=[round(v, 6) for v in (x0, y0, x1, y1)], um_per_px=s, px=[W, H])
    with tempfile.TemporaryDirectory() as tmp:
        raw = os.path.join(tmp, "raw.png")
        lv.save_image_with_options(raw, W, H, 0, 1, 0, kdb.DBox(0, 0, W * s, H * s), False)
        save_png(raw, out, info)
    return dict(info, die_um=[x0, y0, x1, y1], image_um=[x0, y0, x0 + W * s, y0 + H * s], kb=os.path.getsize(out) / 1024,
                read_s=t_read, total_s=time.time() - t0, layers=[f"{l}/{d}" for l, d, _ in chosen])


def main(argv=None):
    p = argparse.ArgumentParser(description="True-scale PNG of a GDS die")
    p.add_argument("gds", help=".gds or .gds.gz")
    p.add_argument("-o", "--out", required=True)
    p.add_argument("--cell", help="default: the only top cell")
    p.add_argument("--um-per-px", type=float, default=1.0, help="square pixel size, default 1")
    p.add_argument("--layers", type=parse_layers, help="'L/D=#rrggbb,...', later ones on top; default all")
    p.add_argument("--outline-layer", type=lambda v: tuple(map(int, v.split("/"))),
                   help="L/D whose bbox is the die box; default the cell bbox")
    a = p.parse_args(argv)
    r = render(a.gds, a.out, a.cell, a.um_per_px, a.layers, a.outline_layer)
    x0, y0, x1, y1 = r["die_um"]
    ix0, iy0, ix1, iy1 = r["image_um"]
    u = lambda v: f"{round(v, 3) + 0:.3f}".rstrip("0").rstrip(".")  # SPEC rule 2; + 0 clears -0.0
    print(f"{a.out}: {r['px'][0]}x{r['px'][1]} px, {r['kb']:.1f} KB, cell {r['cell']}, layers {' '.join(r['layers'])}")
    print(f"die box {u(x0)},{u(y0)} to {u(x1)},{u(y1)} um; {a.um_per_px:g} um/px; image {u(ix0)},{u(iy0)} to {u(ix1)},{u(iy1)} um")
    if ix1 - x1 > 1e-6 or iy1 - y1 > 1e-6:
        print(f"warning: {a.um_per_px:g} um/px does not divide the die, image overshoots by "
              f"{ix1 - x1:.3f} x {iy1 - y1:.3f} um; keep the image size above when placing it")
    if abs(x0) > 1e-6 or abs(y0) > 1e-6:
        print("warning: die box origin is not 0,0, but the die group assumes its origin is the lower-left corner")
    print(f"read {r['read_s']:.1f} s, total {r['total_s']:.1f} s")
    print("inside the die group, after the outline rect:")
    print(f'<g transform="scale(1 -1)"><image x="{u(ix0)}" y="{u(-iy1)}" width="{u(ix1 - ix0)}" '
          f'height="{u(iy1 - iy0)}" preserveAspectRatio="none" href="{os.path.basename(a.out)}"/></g>')


if __name__ == "__main__":
    main()
