"""WBX reference prototype: write, parse, check and export .wb.svg files."""
import math, re, csv, sys, hashlib
import ezdxf
from lxml import etree as ET
WB="urn:wbx:0.1"; SVG="http://www.w3.org/2000/svg"; INK="http://www.inkscape.org/namespaces/inkscape"
q=lambda a:f"{{{WB}}}{a}"
def n(v):
    s=f"{v:.3f}".rstrip('0').rstrip('.'); return '0' if s in('-0','') else s
# ---- geometry --------------------------------------------------------------
def tok(s,span):
    if s.endswith('%'): return float(s[:-1])/100*span
    return float(s)
def loop(moves,span,dz):
    "x,z polyline from first bond; final segment is straight to second bond (x=span,z=dz)"
    pts=[(0.0,0.0)];x=z=0.0
    for m in moves.split():
        v,h=m.split('/'); z+=float(v); x+=tok(h,span); pts.append((x,z))
    pts.append((span,dz)); return pts
def z_at(pts,x):
    for (a,b),(c,d) in zip(pts,pts[1:]):
        if a<=x<=c and c>a: return b+(d-b)*(x-a)/(c-a)
    return pts[-1][1]
def plen(pts): return sum(math.dist(a,b) for a,b in zip(pts,pts[1:]))
# ---- 3. writer -------------------------------------------------------------
COL=dict(sig="#b8860b",pwr="#c0392b",gnd="#2e7d32")
def cls(net): return 'pwr' if net.startswith('VBUS') else 'gnd' if net=='GND' else 'sig'
def write(m,path):
    E=ET.Element
    root=E(f"{{{SVG}}}svg",nsmap={None:SVG,'wb':WB,'inkscape':INK})
    S=lambda p,t,**a:ET.SubElement(p,f"{{{SVG}}}{t}",{(q(k[3:]) if k.startswith('wb_') else k.replace('_','-')):str(v) for k,v in a.items()})
    root.set('viewBox',"-300 -500 12000 9100");root.set('width','1200');root.set('height','910')
    for k,v in dict(version="0.1",units="um",design=m['design'],rev=m['rev'],**{'rule-wire-gap':n(m['rules']['gap']),'rule-edge-clear':n(m['rules']['edge'])}).items(): root.set(q(k),v)
    S(root,'title').text=f"Wire bond diagram: {m['design']} rev {m['rev']}"
    S(root,'style').text=("text{font-family:Helvetica,Arial,sans-serif;fill:#222}.h{font-size:150px;font-weight:bold}.t{font-size:105px}.s{font-size:78px;fill:#555}"
      ".sub{fill:#eef3ea;stroke:#9aa;stroke-width:8}.cu{fill:#d9a441}.die{fill:#c9ccd6;stroke:#667;stroke-width:6}.pad{fill:#f7f7fa;stroke:#445;stroke-width:4}"
      ".w{fill:none;stroke-linecap:round}.sig{stroke:#b8860b}.pwr{stroke:#c0392b}.gnd{stroke:#2e7d32}.lab{font-size:62px;fill:#333}")
    def layer(lbl,**a):
        g=S(root,'g',**a); g.set(f"{{{INK}}}groupmode",'layer'); g.set(f"{{{INK}}}label",lbl); return g
    h=S(root,'text',x=0,y=-220,**{'class':'h'}); h.text=f"{m['design']} rev {m['rev']}: top view (1 unit = 1 um, true scale)"
    g=layer("substrate"); S(g,'rect',x=0,y=0,width=6000,height=6000,**{'class':'sub','wb_kind':'outline','wb_name':'SUB'})
    for l in m['lands']:
        r=S(g,'rect',x=n(l['x']),y=n(l['y']),width=n(l['w']),height=n(l['h']),**{'class':'cu','wb_kind':'land','wb_name':l['name'],'wb_net':l['net'],'wb_finish':'ENIG'})
        S(r,'title').text=f"{l['name']} net {l['net']}"
    d=m['die']; g=S(root,'g',transform=f"translate({n(d['tx'])} {n(d['ty'])}) scale(1 -1)")
    g.set(q('kind'),'die');g.set(q('name'),d['name']);g.set(q('gds-cell'),d['gds']);g.set(q('pad-layer'),d['layer']);g.set(f"{{{INK}}}groupmode",'layer');g.set(f"{{{INK}}}label",'die')
    S(g,'rect',x=0,y=0,width=n(d['w']),height=n(d['h']),**{'class':'die','wb_kind':'outline'})
    for p in m['pads']:
        r=S(g,'rect',x=n(p['x']),y=n(p['y']),width=n(p['w']),height=n(p['h']),**{'class':'pad','wb_kind':'pad','wb_name':p['name'],'wb_net':p['net']})
        S(r,'title').text=f"U1 pad {p['name']} net {p['net']}"
    W=layer("wires"); pf={p['name']:p for p in m['prof']}
    for w in m['wires']:
        p=pf[w['profile']]
        l=S(W,'line',x1=n(w['x1']),y1=n(w['y1']),x2=n(w['x2']),y2=n(w['y2']),stroke_width=n(p['d']),**{'class':'w '+cls(w['net']),'wb_kind':'wire','wb_name':w['name'],'wb_from':w['frm'],'wb_to':w['to'],'wb_profile':w['profile'],'wb_seq':w['seq'],'wb_tier':w['tier'],'wb_net':w['net']})
        S(l,'title').text=f"{w['name']} {w['net']}: {w['frm']} to {w['to']}, {p['material']} {p['d']} um, {w['profile']}, seq {w['seq']}, tier {w['tier']}"
    g=layer("bonds (derived)")
    for w in m['wires']:
        p=pf[w['profile']]; S(g,'circle',cx=n(w['x1']),cy=n(w['y1']),r=n(p['d']*1.3),fill=COL[cls(w['net'])])
    g=layer("labels (derived)")
    for l in m['lands']:
        S(g,'text',x=n(l['x']+l['w']/2),y=n(l['y']+l['h']/2+22),text_anchor='middle',**{'class':'lab'}).text=l['net']
    # side view
    Y0=7500
    h=S(root,'text',x=0,y=6500,**{'class':'h'}); h.text="Section through die centre (true scale, z up)"
    g=S(root,'g',transform=f"translate(0 {Y0})"); g.set(q('kind'),'stack'); g.set(f"{{{INK}}}groupmode",'layer'); g.set(f"{{{INK}}}label",'stack')
    sty=dict(substrate="fill:#eef3ea;stroke:#9aa;stroke-width:6",attach="fill:#888",die="fill:#c9ccd6;stroke:#667;stroke-width:6",mold="fill:#7aa7c7;fill-opacity:.18;stroke:#7aa7c7;stroke-width:6;stroke-dasharray:40 30")
    for s in m['stack']:
        r=S(g,'rect',x=n(s['x']),y=n(-(s['z']+s['t'])),width=n(s['w']),height=n(s['t']),style=sty[s['role']],**{'wb_kind':'layer','wb_name':s['name'],'wb_role':s['role'],'wb_material':s['material']})
        S(r,'title').text=f"{s['name']}: {s['material']}, {n(s['t'])} um thick"
    top=[s for s in m['stack'] if s['role']=='die'][0]; ztop=top['z']+top['t']
    for w in m['wires']:          # section wires on the y=centre row, derived
        if abs(w['y1']-(d['ty']-d['h']/2))<1 and w['net']!='VBUS':
            p=pf[w['profile']]; span=math.dist((w['x1'],w['y1']),(w['x2'],w['y2'])); pts=loop(p['moves'],span,-ztop)
            sgn=math.copysign(1,w['x2']-w['x1'])
            S(g,'polyline',points=' '.join(f"{n(w['x1']+sgn*x)},{n(-(ztop+z))}" for x,z in pts),stroke_width=n(p['d']),**{'class':'w '+cls(w['net'])})
    S(root,'text',x=3000,y=Y0-800+100,text_anchor='middle',**{'class':'s'}).text="glob top envelope"
    # profile library
    X=6500
    S(root,'text',x=X,y=-220,**{'class':'h'}).text="Loop profiles (drawn at reference span)"
    yy=250
    for p in m['prof']:
        g=S(root,'g',transform=f"translate({X} {yy+420})")
        g.set(q('kind'),'profile');g.set(q('name'),p['name']);g.set(q('material'),p['material']);g.set(q('style'),p['style']);g.set(q('dir'),p['dir']);g.set(q('moves'),p['moves']);g.set(q('interp'),p['interp']);g.set(q('ref-span'),n(p['refspan']))
        g.set(f"{{{INK}}}groupmode",'layer');g.set(f"{{{INK}}}label",'profile '+p['name'])
        pts=loop(p['moves'],p['refspan'],0)
        S(g,'line',x1=0,y1=0,x2=n(p['refspan']),y2=0,stroke='#bbb',stroke_width=6)
        pl=S(g,'polyline',points=' '.join(f"{n(x)},{n(-z)}" for x,z in pts),stroke_width=n(p['d']),**{'class':'w sig'})
        S(pl,'title').text=f"{p['name']} moves {p['moves']}"
        S(root,'text',x=X+1250,y=yy+140,**{'class':'t'}).text=f"{p['name']}: {p['material']} {p['d']} um, {p['style']}"
        S(root,'text',x=X+1250,y=yy+290,**{'class':'s'}).text=f"{p['dir']}, moves {p['moves']}"
        S(root,'text',x=X+1250,y=yy+400,**{'class':'s'}).text=f"control points shown at {p['refspan']} um span; {p['interp']} between them"
        yy+=680
    # schedule
    yy+=120; S(root,'text',x=X,y=yy,**{'class':'h'}).text="Stack";yy+=170
    for s in m['stack']:
        S(root,'text',x=X,y=yy,**{'class':'t'}).text=f"{s['name']}: {s['material']}, {n(s['t'])} um, z {n(s['z'])} to {n(s['z']+s['t'])}";yy+=140
    yy+=120; S(root,'text',x=X,y=yy,**{'class':'h'}).text="Key";yy+=170
    for c,t in (('sig','Signal, tier 1'),('pwr','VBUS, parallel 33 um pair, tier 1'),('gnd','Down bond to ground land, tier 2')):
        S(root,'line',x1=X,y1=yy-30,x2=X+300,y2=yy-30,stroke_width=25,**{'class':'w '+c}); S(root,'text',x=X+380,y=yy,**{'class':'t'}).text=t; yy+=140
    yy+=60;S(root,'text',x=X,y=yy,**{'class':'s'}).text="Illustrative data only. Hover any wire, pad or layer for details."
    ET.ElementTree(root).write(path,xml_declaration=True,encoding='utf-8',pretty_print=True)
# ---- 4. reader -------------------------------------------------------------
def rd(path):
    t=ET.parse(path).getroot()
    A=lambda e,k:e.get(q(k)); F=lambda e,k:float(e.get(k))
    kinds=lambda k:[e for e in t.iter() if e.get(q('kind'))==k]
    d=kinds('die')[0]; tr=re.match(r"translate\(([-\d.]+) ([-\d.]+)\) scale\(1 -1\)",d.get('transform'))
    o=[c for c in d if c.get(q('kind'))=='outline'][0]
    m=dict(design=A(t,'design'),rev=A(t,'rev'),die=dict(name=A(d,'name'),w=F(o,'width'),h=F(o,'height'),tx=float(tr[1]),ty=float(tr[2]),gds=A(d,'gds-cell'),layer=A(d,'pad-layer')),
           rules=dict(gap=float(A(t,'rule-wire-gap')),edge=float(A(t,'rule-edge-clear'))))
    R=lambda e:dict(name=A(e,'name'),net=A(e,'net'),x=F(e,'x'),y=F(e,'y'),w=F(e,'width'),h=F(e,'height'))
    m['pads']=[R(e) for e in kinds('pad')]; m['lands']=[R(e) for e in kinds('land')]
    m['stack']=[dict(name=A(e,'name'),role=A(e,'role'),material=A(e,'material'),z=-(F(e,'y')+F(e,'height')),t=F(e,'height'),x=F(e,'x'),w=F(e,'width')) for e in kinds('layer')]
    def num(v):
        v=float(v); return int(v) if v==int(v) else v
    m['prof']=[]
    for e in kinds('profile'):
        pl=[c for c in e if c.tag.endswith('polyline')][0]
        m['prof'].append(dict(name=A(e,'name'),material=A(e,'material'),d=num(pl.get('stroke-width')),style=A(e,'style'),dir=A(e,'dir'),moves=A(e,'moves'),interp=A(e,'interp'),refspan=num(A(e,'ref-span'))))
    m['wires']=[dict(name=A(e,'name'),frm=A(e,'from'),to=A(e,'to'),profile=A(e,'profile'),seq=int(A(e,'seq')),tier=int(A(e,'tier')),net=A(e,'net'),x1=F(e,'x1'),y1=F(e,'y1'),x2=F(e,'x2'),y2=F(e,'y2'),sw=float(e.get('stroke-width'))) for e in kinds('wire')]
    return m
def segd(a,b,c,d):
    def p(pt,a,b):
        ax,ay=a;bx,by=b;l=(bx-ax)**2+(by-ay)**2;t=max(0,min(1,((pt[0]-ax)*(bx-ax)+(pt[1]-ay)*(by-ay))/l));return math.dist(pt,(ax+t*(bx-ax),ay+t*(by-ay)))
    def o(a,b,c): return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
    if o(a,b,c)*o(a,b,d)<0 and o(c,d,a)*o(c,d,b)<0: return 0
    return min(p(a,c,d),p(b,c,d),p(c,a,b),p(d,a,b))
def check(m):
    out=[];d=m['die'];pads={f"{d['name']}.{p['name']}":p for p in m['pads']};lands={l['name']:l for l in m['lands']};pf={p['name']:p for p in m['prof']}
    S={s['role']:s for s in m['stack']};ztop=S['die']['z']+S['die']['t'];cap=S['mold']['z']+S['mold']['t']
    x0,y0,x1,y1=d['tx'],d['ty']-d['h'],d['tx']+d['w'],d['ty']
    res=dict(wires=len(m['wires']),pads=len(pads))
    mx=[];minedge=1e9;L=[]
    for w in m['wires']:
        p=pads[w['frm']];l=lands[w['to']];pr=pf[w['profile']]
        gx,gy=w['x1']-d['tx'],d['ty']-w['y1']
        if not(p['x']<=gx<=p['x']+p['w'] and p['y']<=gy<=p['y']+p['h']): out.append(f"{w['name']}: first bond off pad {w['frm']}")
        if not(l['x']<=w['x2']<=l['x']+l['w'] and l['y']<=w['y2']<=l['y']+l['h']): out.append(f"{w['name']}: second bond off land {w['to']}")
        if w['net']!=p['net'] or w['net']!=l['net']: out.append(f"{w['name']}: net mismatch")
        if 'sw' in w and abs(w['sw']-pr['d'])>1e-6: out.append(f"{w['name']}: stroke-width != profile diameter")
        span=math.dist((w['x1'],w['y1']),(w['x2'],w['y2']));pts=loop(pr['moves'],span,-ztop)
        L.append(plen(pts));mx.append(ztop+max(z for _,z in pts))
        if mx[-1]>cap: out.append(f"{w['name']}: above cap")
        ux,uy=(w['x2']-w['x1'])/span,(w['y2']-w['y1'])/span
        ts=[(a-b)/c for a,b,c in((x0,w['x1'],ux),(x1,w['x1'],ux),(y0,w['y1'],uy),(y1,w['y1'],uy)) if abs(c)>1e-9]
        pos=[t for t in ts if t>0]
        if not pos: out.append(f"{w['name']}: first bond not on die"); continue
        ex=min(pos); cl=z_at(pts,ex); minedge=min(minedge,cl)
        if cl<m['rules']['edge']: out.append(f"{w['name']}: die edge clearance {cl:.0f}")
    gap=1e9;W=m['wires']
    for i,a in enumerate(W):
        for b in W[i+1:]:
            if a['frm']==b['frm']: continue
            g=segd((a['x1'],a['y1']),(a['x2'],a['y2']),(b['x1'],b['y1']),(b['x2'],b['y2']));gap=min(gap,g)
            if g<m['rules']['gap']: out.append(f"{a['name']}/{b['name']}: gap {g:.0f}")
    res.update(length=(min(L),max(L)),top=max(mx),cap=cap,edge=minedge,gap=gap)
    return res,out
def canon(m):
    def clean(w): return {k:v for k,v in w.items() if k!='sw'}
    x=dict(m);x['wires']=[clean(w) for w in m['wires']];return x
def export(m,base):
    pf={p['name']:p for p in m['prof']};S={s['role']:s for s in m['stack']};ztop=S['die']['z']+S['die']['t']
    D=m['die'];cx,cy=D['tx']+D['w']/2,D['ty']-D['h']/2   # exports are centred on the die
    with open(base+'.bondlist.csv','w',newline='') as f:
        c=csv.writer(f);c.writerow("seq tier wire net from to x1_um y1_um z1_um x2_um y2_um z2_um profile".split())
        for w in sorted(m['wires'],key=lambda w:w['seq']):
            c.writerow([w['seq'],w['tier'],w['name'],w['net'],w['frm'],w['to'],n(w['x1']-cx),n(cy-w['y1']),n(ztop),n(w['x2']-cx),n(cy-w['y2']),0,w['profile']])
    d=ezdxf.new('R2010');ms=d.modelspace()
    for w in m['wires']:
        p=pf[w['profile']];sp=math.dist((w['x1'],w['y1']),(w['x2'],w['y2']));ux,uy=(w['x2']-w['x1'])/sp,(w['y2']-w['y1'])/sp
        ms.add_polyline3d([(w['x1']+ux*x-cx,cy-(w['y1']+uy*x),ztop+z) for x,z in loop(p['moves'],sp,-ztop)],dxfattribs={'layer':f"WIRE_T{w['tier']}"})
    d.saveas(base+'.dxf')
def main(argv=None):
    import argparse, json
    p=argparse.ArgumentParser(description="WBX prototype tools")
    sub=p.add_subparsers(dest="cmd",required=True)
    c=sub.add_parser("check",help="validate a .wb.svg"); c.add_argument("file")
    e=sub.add_parser("export",help="write bondlist CSV and 3D DXF"); e.add_argument("file"); e.add_argument("base")
    a=p.parse_args(argv); m=rd(a.file)
    if a.cmd=="check":
        res,errs=check(m); print(json.dumps(res,indent=2))
        for x in errs: print("ERROR",x)
        print(f"{len(errs)} error(s)"); return 1 if errs else 0
    export(m,a.base); print("wrote",a.base+".bondlist.csv",a.base+".dxf"); return 0
if __name__=="__main__":
    sys.exit(main())
