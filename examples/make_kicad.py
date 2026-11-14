"""Generate examples/kicad/example.kicad_{pro,pcb} from examples/example.wb.svg.

This is a bootstrap so the numbers can't drift. The long-term direction is the
reverse, KiCad -> WBX: the board is the input a future importer will read.
Mapping: KiCad mm = SVG um / 1000, no offset, both y-down. See kicad/README.md.
"""
import json, os, sys, uuid
from lxml import etree as ET
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import wbx

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "example.wb.svg")
OUT = os.path.join(HERE, "kicad")
WIRE_LAYER = "User.1"  # named "Wirebond" in the layer table; objects must use the canonical name
NS = uuid.UUID("6f1d3a52-7a40-4c7e-9a55-0b9d4c1e2a10")

# ---- s-expressions: head atoms stay on one line, child lists indent, like KiCad's own output
def Q(s):
    return '"' + str(s).replace("\\", "\\\\").replace('"', '\\"') + '"'
def nm(um):
    "um -> integer nm; WBX keeps at most 3 decimals, so this is exact"
    return round(um * 1000)
def mm(nanometres):
    s = f"{abs(nanometres) / 1e6:.6f}".rstrip("0").rstrip(".")
    return "-" + s if nanometres < 0 else s
def half(nanometres):
    "half a dimension, which must land on KiCad's 1 nm grid to be lossless"
    if nanometres % 2:
        raise ValueError(f"{nanometres} nm is odd: its centre is off the 1 nm grid")
    return nanometres // 2
def sx(node, ind=0):
    pad = "\t" * ind
    head = " ".join(a for a in node if not isinstance(a, list))
    kids = [a for a in node if isinstance(a, list)]
    if not kids:
        return f"{pad}({head})"
    return f"{pad}({head}\n" + "\n".join(sx(k, ind + 1) for k in kids) + f"\n{pad})"
def uid(*key):
    return ["uuid", Q(uuid.uuid5(NS, "/".join(map(str, key))))]

# ---- footprint parts
def font(size):
    return ["effects", ["font", ["size", mm(size), mm(size)], ["thickness", mm(size // 8)]]]
def prop(owner, key, val, at=(0, 0), hide=True, size=100_000):
    return ["property", Q(key), Q(val), ["at", mm(at[0]), mm(at[1]), "0"], ["unlocked", "yes"], ["layer", Q("F.Fab")],
            *([["hide", "yes"]] if hide else []), uid(owner, "prop", key), font(size)]
def stock_field(owner, key):
    "KiCad adds these two to every footprint on save; writing them keeps their uuids stable"
    return ["property", Q(key), Q(""), ["at", "0", "0", "0"], ["layer", Q("F.Fab")], ["hide", "yes"], uid(owner, "prop", key),
            ["effects", ["font", ["size", "1.27", "1.27"]]]]
def footprint(kind, ref, value, x, y, attr, props, items, ref_at=(0, 0), ref_hide=True, ref_size=100_000):
    # no "lib:" prefix: these footprints exist only in this board, and a made-up library draws one DRC warning each
    return ["footprint", Q(kind), ["layer", Q("F.Cu")], uid(ref, "footprint"), ["at", mm(x), mm(y)],
            prop(ref, "Reference", ref, ref_at, ref_hide, ref_size), prop(ref, "Value", value),
            stock_field(ref, "Datasheet"), stock_field(ref, "Description"),
            *[prop(ref, k, v) for k, v in sorted(props + [("wb_kind", kind)])], ["attr", *attr],
            ["duplicate_pad_numbers_are_jumpers", "no"], *items, ["embedded_fonts", "no"]]
def pad(owner, number, cx, cy, w, h, layers, net):
    return ["pad", Q(number), "smd", "rect", ["at", mm(cx), mm(cy)], ["size", mm(w), mm(h)],
            ["layers", *map(Q, layers)], ["net", Q(net)], ["pintype", Q("passive")], uid(owner, "pad", number)]
def stroke(width):
    return ["stroke", ["width", mm(width)], ["type", "solid"]]

# ---- objects
def die_fp(m):
    d = m["die"]; W, H = nm(d["w"]), nm(d["h"])
    pads = [pad(d["name"], p["name"], nm(p["x"]) + half(nm(p["w"])), -(nm(p["y"]) + half(nm(p["h"]))),
                nm(p["w"]), nm(p["h"]), ["F.Cu"], p["net"]) for p in m["pads"]]
    outline = ["fp_rect", ["start", "0", mm(-H)], ["end", mm(W), "0"], stroke(10_000), ["fill", "no"],
               ["layer", Q("F.Fab")], uid(d["name"], "outline")]
    return footprint("die", d["name"], d["gds"], nm(d["tx"]), nm(d["ty"]), ["smd", "board_only"],
                     [("wb_gds_cell", d["gds"]), ("wb_pad_layer", d["layer"])], [outline, *pads],
                     ref_at=(half(W), -half(H)), ref_hide=False, ref_size=300_000)
def land_fp(l, finish):
    w, h = nm(l["w"]), nm(l["h"])
    return footprint("land", l["name"], "land", nm(l["x"]) + half(w), nm(l["y"]) + half(h),
                     ["smd", "board_only", "exclude_from_pos_files", "exclude_from_bom"], [("wb_finish", finish)],
                     [pad(l["name"], "1", 0, 0, w, h, ["F.Cu", "F.Mask"], l["net"])], ref_hide=False, ref_size=60_000)
def wire_fp(w):
    # anchored on the first bond, so (at) is the first bond and the line's end is the offset to the second
    x1, y1, x2, y2 = nm(w["x1"]), nm(w["y1"]), nm(w["x2"]), nm(w["y2"])
    line = ["fp_line", ["start", "0", "0"], ["end", mm(x2 - x1), mm(y2 - y1)], stroke(nm(w["sw"])),
            ["layer", Q(WIRE_LAYER)], uid(w["name"], "line")]
    return footprint("wire", w["name"], "wire", x1, y1, ["board_only", "exclude_from_pos_files", "exclude_from_bom"],
                     [("wb_from", w["frm"]), ("wb_to", w["to"]), ("wb_profile", w["profile"]), ("wb_seq", w["seq"]),
                      ("wb_tier", w["tier"]), ("wb_net", w["net"])], [line])

def fid_fp(f, clear):
    """A board fiducial: one unnumbered pad at the reference point, with the mask opened by the clear distance.
    align fiducials carry KiCad's own fiducial property, which goes into the Gerbers. Die fiducials stay with the GDS."""
    if f.get("shape", "circle") not in ("circle", "rect"):
        raise NotImplementedError(f"{f['name']}: only circle and rect board fiducials map to a KiCad pad so far")
    x, y = wbx.fref(f, None)
    w, h = (nm(f["d"]), nm(f["d"])) if f.get("shape", "circle") == "circle" else (nm(f["w"]), nm(f["h"]))
    p = ["pad", Q(""), "smd", "circle" if f.get("shape", "circle") == "circle" else "rect", ["at", "0", "0"], ["size", mm(w), mm(h)],
         *([["property", "pad_prop_fiducial_glob"]] if f.get("role", "align") == "align" else []),
         ["layers", Q("F.Cu"), Q("F.Mask")], ["solder_mask_margin", mm(nm(clear))], uid(f["name"], "pad")]
    props = [("wb_role", f.get("role", "align"))] + ([("wb_datum", f["datum"])] if f.get("datum") else [])
    return footprint("fiducial", f["name"], "fiducial", nm(x), nm(y), ["smd", "board_only", "exclude_from_bom"], props, [p],
                     ref_hide=False, ref_size=150_000, ref_at=(0, -w // 2 - 250_000))

def board_props(m, extra):
    "Flat key/value text. KiCad stores these sorted by key, so records carry an index to keep their order."
    out = [("wb_version", extra["version"]), ("wb_units", extra["units"]), ("wb_design", m["design"]), ("wb_rev", m["rev"]),
           ("wb_rule_wire_gap", wbx.n(m["rules"]["gap"])), ("wb_rule_edge_clear", wbx.n(m["rules"]["edge"])),
           ("wb_substrate_name", extra["outline"]["name"])]
    if "fid" in m["rules"]:
        out.append(("wb_rule_fid_clear", wbx.n(m["rules"]["fid"])))
    for i, p in enumerate(m["prof"], 1):
        out += [(f"wb_profile_{i}_{k}", v) for k, v in (("name", p["name"]), ("material", p["material"]), ("d", wbx.n(p["d"])),
                 ("style", p["style"]), ("dir", p["dir"]), ("moves", p["moves"]), ("interp", p["interp"]), ("ref_span", wbx.n(p["refspan"])))]
    for i, s in enumerate(m["stack"], 1):
        out += [(f"wb_stack_{i}_{k}", v) for k, v in (("name", s["name"]), ("role", s["role"]), ("material", s["material"]),
                 ("z", wbx.n(s["z"])), ("t", wbx.n(s["t"])), ("x", wbx.n(s["x"])), ("w", wbx.n(s["w"])))]
    return out

def read_extra(path):
    "The few things wbx.rd() leaves out: land finish, substrate outline, and the root version and units."
    root = ET.parse(path).getroot(); A = lambda e, k: e.get(wbx.q(k))
    o = [e for e in root.iter() if A(e, "kind") == "outline" and A(e, "name")][0]
    return dict(version=A(root, "version"), units=A(root, "units"),
                finish={A(e, "name"): A(e, "finish") for e in root.iter() if A(e, "kind") == "land"},
                outline=dict(name=A(o, "name"), x=float(o.get("x")), y=float(o.get("y")), w=float(o.get("width")), h=float(o.get("height"))))

LAYERS = [("0", "F.Cu", "signal"), ("2", "B.Cu", "signal"), ("9", "F.Adhes", "user", "F.Adhesive"), ("11", "B.Adhes", "user", "B.Adhesive"),
          ("13", "F.Paste", "user"), ("15", "B.Paste", "user"), ("5", "F.SilkS", "user", "F.Silkscreen"), ("7", "B.SilkS", "user", "B.Silkscreen"),
          ("1", "F.Mask", "user"), ("3", "B.Mask", "user"), ("17", "Dwgs.User", "user", "User.Drawings"), ("19", "Cmts.User", "user", "User.Comments"),
          ("21", "Eco1.User", "user", "User.Eco1"), ("23", "Eco2.User", "user", "User.Eco2"), ("25", "Edge.Cuts", "user"), ("27", "Margin", "user"),
          ("31", "F.CrtYd", "user", "F.Courtyard"), ("29", "B.CrtYd", "user", "B.Courtyard"), ("35", "F.Fab", "user"), ("33", "B.Fab", "user"),
          ("39", WIRE_LAYER, "user", "Wirebond")]

def board(m, extra):
    o = extra["outline"]; sub = [s for s in m["stack"] if s["role"] == "substrate"][0]
    x0, y0 = nm(o["x"]), nm(o["y"])
    edge = ["gr_rect", ["start", mm(x0), mm(y0)], ["end", mm(x0 + nm(o["w"])), mm(y0 + nm(o["h"]))], stroke(50_000), ["fill", "no"],
            ["layer", Q("Edge.Cuts")], uid("substrate", "outline")]
    layer_row = lambda r: [r[0], Q(r[1]), r[2], *([Q(r[3])] if len(r) > 3 else [])]
    return ["kicad_pcb", ["version", "20260206"], ["generator", Q("wbx_make_kicad")], ["generator_version", Q("10.0")],
            ["general", ["thickness", mm(nm(sub["t"]))], ["legacy_teardrops", "no"]], ["paper", Q("A4")],
            ["title_block", ["title", Q("${wb_design}")], ["rev", Q("${wb_rev}")]],
            ["layers", *map(layer_row, LAYERS)], ["setup", ["pad_to_mask_clearance", "0"]],
            *[["property", Q(k), Q(v)] for k, v in board_props(m, extra)],
            die_fp(m), *[land_fp(l, extra["finish"][l["name"]]) for l in m["lands"]], *[wire_fp(w) for w in m["wires"]],
            *[fid_fp(f, m["rules"].get("fid", 0)) for f in m.get("fid", []) if f.get("frame", "board") == "board"],
            edge, ["embedded_fonts", "no"]]

def project(props):
    # The project's text variables must repeat the board properties. pcbnew's BOARD.SynchronizeProperties()
    # overwrites the board table with this one, so leaving it empty erases every wb_ board property.
    return {"board": {"design_settings": {"defaults": {}, "diff_pair_dimensions": [], "drc_exclusions": [], "rules": {},
                                          "track_widths": [], "via_dimensions": []}},
            "boards": [], "libraries": {"pinned_footprint_libs": [], "pinned_symbol_libs": []},
            "meta": {"filename": "example.kicad_pro", "version": 1}, "net_settings": {"classes": [], "meta": {"version": 0}},
            "pcbnew": {"page_layout_descr_file": ""}, "sheets": [], "text_variables": dict(sorted(props))}

def main():
    m, extra = wbx.rd(SRC), read_extra(SRC)
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "example.kicad_pcb"), "w", encoding="utf-8", newline="\n") as f:
        f.write(sx(board(m, extra)) + "\n")
    with open(os.path.join(OUT, "example.kicad_pro"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(project(board_props(m, extra)), f, indent=2); f.write("\n")
    print("wrote", OUT)

if __name__ == "__main__":
    main()
