"""Measure what the generated board changed against a copy of its source: DRC, parity, Gerbers, position file, and a pcbnew round trip.

    python proto_verify.py NAME SOURCE_DIR STEM DIE.die.json DIE.wrl WORKDIR

SOURCE_DIR is itself a working copy holding STEM.kicad_pcb, .kicad_pro and .kicad_sch. Everything is written under
WORKDIR/NAME, in one folder per variant:

    base      the source, untouched
    noattr    die and wires as the first prototype wrote them: no board_only, no WBLIB
    only      board_only added, no WBLIB
    final     board_only and WBLIB
    rt_pro    final after pcbnew LoadBoard + SaveBoard, with a .kicad_pro alongside
    rt_nopro  the same with no project file
    regen     rt_pro with PWR33 edited in WBLIB to 38 um, then regenerated
"""
import collections, json, os, re, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import proto_assemble as A

BIN = r"C:\Program Files\KiCad\10.0\bin"
CLI = os.path.join(BIN, 'kicad-cli.exe')
KPY = os.path.join(BIN, 'python.exe')
LAYERS = 'F.Cu,B.Cu,F.SilkS,B.SilkS,F.Mask,B.Mask,F.Paste,B.Paste,Edge.Cuts'
RT = '''
import json, sys, wx
log = wx.LogStderr()   # otherwise a missing font (Audiowide on these boards) opens a modal box and LoadBoard hangs
wx.Log.SetActiveTarget(log)
import pcbnew
b = pcbnew.LoadBoard(sys.argv[1])
pcbnew.SaveBoard(sys.argv[1], b)
b = pcbnew.LoadBoard(sys.argv[1])
out = []
for f in b.GetFootprints():
    r = f.GetReference()
    if r == 'WBLIB' or r == 'D1' or r.startswith('W') and r[1:].isdigit():
        out.append((r, f.IsBoardOnly(), f.IsExcludedFromPosFiles(), f.IsExcludedFromBOM(), sorted((x.GetName(), x.GetText(), x.IsVisible()) for x in f.GetFields() if x.GetName().startswith('wb_type_')) if r == 'WBLIB' else []))
print('API', json.dumps(out))
'''


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=400)


def drc(d, stem):
    j = os.path.join(d, 'drc.json')
    r = run([CLI, 'pcb', 'drc', '--schematic-parity', '--severity-all', '--format', 'json', '-o', j, os.path.join(d, stem + '.kicad_pcb')])
    if not os.path.exists(j):
        return dict(error=r.stderr[-400:] or r.stdout[-400:])
    x = json.load(open(j, encoding='utf-8'))
    v = collections.Counter(i['type'] for i in x.get('violations', []))
    p = collections.Counter(i['type'] for i in x.get('schematic_parity', []))
    return dict(violations=dict(v), unconnected=len(x.get('unconnected_items', [])), parity=dict(p), total=sum(v.values()))


def gerbers(d, stem):
    g = os.path.join(d, 'gerbers')
    os.makedirs(g, exist_ok=True)
    run([CLI, 'pcb', 'export', 'gerbers', '--layers', LAYERS, '-o', g + os.sep, os.path.join(d, stem + '.kicad_pcb')])
    return g


def gerber_lines(path):
    """Everything but the header lines that hold the date, the file name and the project name."""
    keep = []
    for line in open(path, encoding='utf-8', errors='replace'):
        if line.startswith(('G04', '%TF.')):
            continue
        keep.append(line)
    return keep


def gerber_diff(a, b, stem_a, stem_b):
    """Per file: changed-line count, ignoring the header. "-F_Cu.gtl" on one side is matched to the same suffix on the other."""
    out = {}
    for f in sorted(os.listdir(a)):
        if f.endswith('.gbrjob'):
            continue
        suf = f[len(stem_a):]
        pb = os.path.join(b, stem_b + suf)
        if not os.path.exists(pb):
            out[suf] = 'missing'
            continue
        la, lb = gerber_lines(os.path.join(a, f)), gerber_lines(pb)
        # a pcbnew save reorders zones, which reorders the plot; the objects are then what to compare
        moved = sum(((collections.Counter(objects(la)) - collections.Counter(objects(lb))) + (collections.Counter(objects(lb)) - collections.Counter(objects(la)))).values())
        out[suf] = dict(identical=la == lb, objects=len(objects(la)), objects_differing=moved)
    return out


def objects(lines):
    """Split a plot into objects at each attribute, polarity or region start, so order can be ignored."""
    out, cur = [], []
    for line in lines:
        if line.startswith(('%TO.', '%TD', 'G36', '%LP')) and cur:
            out.append(''.join(cur))
            cur = []
        cur.append(line)
    if cur:
        out.append(''.join(cur))
    return out


def pos_count(d, stem):
    o = os.path.join(d, 'pos.csv')
    run([CLI, 'pcb', 'export', 'pos', '--format', 'csv', '--units', 'mm', '-o', o, os.path.join(d, stem + '.kicad_pcb')])
    if not os.path.exists(o):
        return None
    return max(0, sum(1 for _ in open(o, encoding='utf-8', errors='replace')) - 1)


def generate(name, src, die_json, die_wrl, out, *flags):
    r = run([sys.executable, '-B', '-X', 'utf8', os.path.join(HERE, 'proto_assemble.py'), src, die_json, die_wrl, out, *flags])
    if r.returncode:
        raise SystemExit(name + ': ' + r.stderr[-800:])
    return r.stdout


def clone(a, b, skip=()):
    os.makedirs(b, exist_ok=True)
    for f in os.listdir(a):
        p = os.path.join(a, f)
        if f.endswith(tuple(skip)) and skip:
            continue
        if f.startswith('assembly.') or f == '3d':
            if os.path.isdir(p):
                shutil.copytree(p, os.path.join(b, f), dirs_exist_ok=True)
            elif not f.endswith(('.kicad_prl',)):
                shutil.copy2(p, b)


def roundtrip(path):
    r = run([KPY, '-c', RT, path])
    m = re.search(r'^API (.*)$', r.stdout, re.M)
    return json.loads(m[1]) if m else ('FAILED', r.stderr[-500:])


def survival(path, api):
    t = open(path, encoding='utf-8').read()
    types, found = A.read_library(t)
    fp = [t[s:e] for s, e, lib in A.footprints(t)]
    gen = [f for f in fp if re.match(r'\(footprint\s+"wbx_', f)]
    attrs = collections.Counter(re.search(r'\(attr [^)]*\)', f)[0] for f in gen)
    lib = next((f for f in gen if 'wbx_lib:' in f), '')
    hidden = len(re.findall(r'\(property\s+"wb_type_[^"]+".*?\(hide yes\)', lib, re.S))
    return dict(footprints=len(gen), attrs=dict(attrs), wblib_found=found, types={k: v['raw'] for k, v in types.items()}, hidden_type_fields=hidden,
                api_board_only=sum(1 for x in api if x[1]), api_no_pos=sum(1 for x in api if x[2]), api_no_bom=sum(1 for x in api if x[3]), api_rows=len(api),
                api_wblib_fields=next((x[4] for x in api if x[0] == 'WBLIB'), None))


def main(name, src, stem, die_json, die_wrl, work):
    root = os.path.join(work, name)
    os.makedirs(root, exist_ok=True)
    report = {}
    board = os.path.join(src, stem + '.kicad_pcb')
    base = os.path.join(root, 'base')
    os.makedirs(base, exist_ok=True)
    for ext in ('.kicad_pcb', '.kicad_pro', '.kicad_sch'):
        shutil.copy2(os.path.join(src, stem + ext), base)
    for v, flags in (('noattr', ['--skip-attr', '--no-wblib']), ('only', ['--no-wblib']), ('final', [])):
        out = os.path.join(root, v)
        report.setdefault('stdout', {})[v] = generate(v, board, die_json, die_wrl, out, *flags)
    # rt_pro and rt_nopro start from final
    rp, rn = os.path.join(root, 'rt_pro'), os.path.join(root, 'rt_nopro')
    clone(os.path.join(root, 'final'), rp)
    clone(os.path.join(root, 'final'), rn, skip=('.kicad_pro',))
    report['survival_rt_pro'] = survival(os.path.join(rp, 'assembly.kicad_pcb'), roundtrip(os.path.join(rp, 'assembly.kicad_pcb')))
    report['survival_rt_nopro'] = survival(os.path.join(rn, 'assembly.kicad_pcb'), roundtrip(os.path.join(rn, 'assembly.kicad_pcb')))
    # edit a type in the round-tripped library, regenerate from that board, and see if the wires follow
    edited = os.path.join(root, 'regen_in')
    clone(rp, edited)
    ep = os.path.join(edited, 'assembly.kicad_pcb')
    t = open(ep, encoding='utf-8').read()
    t2 = t.replace('ball-wedge Au 33 forward', 'ball-wedge Au 38 forward')
    open(ep, 'w', encoding='utf-8').write(t2)
    regen = os.path.join(root, 'regen')
    report['stdout']['regen'] = generate('regen', ep, die_json, die_wrl, regen)
    rt = open(os.path.join(regen, 'assembly.kicad_pcb'), encoding='utf-8').read()
    fp = [(lib, rt[s:e]) for s, e, lib in A.footprints(rt)]
    wires = [f for lib, f in fp if lib.startswith('wbx_wire:')]
    report['regen'] = dict(edit_applied=t != t2, wires=len(wires), dies=sum(lib.startswith('wbx_die:') for lib, _ in fp), wblib=sum(lib.startswith('wbx_lib:') for lib, _ in fp),
                           widths=dict(collections.Counter(re.search(r'\(fp_line.*?\(width ([\d.]+)\)', f, re.S)[1] for f in wires)), types=A.read_library(rt)[0]['PWR33']['raw'])
    variants = {'base': stem, 'noattr': 'assembly', 'only': 'assembly', 'final': 'assembly', 'rt_pro': 'assembly'}
    gdirs = {}
    report['drc'], report['pos'] = {}, {}
    for v, s in variants.items():
        d = os.path.join(root, v)
        report['drc'][v] = drc(d, s)
        gdirs[v] = gerbers(d, s)
        report['pos'][v] = pos_count(d, s)
    report['gerber_diff'] = {v: gerber_diff(gdirs['base'], gdirs[v], stem, variants[v]) for v in variants if v != 'base'}
    json.dump(report, open(os.path.join(root, 'verify.json'), 'w'), indent=1, default=str)
    show = {k: v for k, v in report.items() if k != 'stdout'}
    print(json.dumps(show, indent=1, default=str))


if __name__ == '__main__':
    main(*sys.argv[1:7])
