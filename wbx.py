"""WBX reference prototype: write, parse, check and export .wb.svg files."""
import math, re, csv, sys, hashlib, copy
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
# ---- fiducials ---------------------------------------------------------------
def pathpts(d):
    "corner points of a straight-segment path (M L H V Z, either case)"
    t=re.findall(r"[A-Za-z]|-?\d+(?:\.\d+)?",d);i=0;x=y=0.0;sx=sy=0.0;c='M';out=[]
    while i<len(t):
        if t[i].isalpha(): c=t[i];i+=1
        if c in 'Zz': x,y=sx,sy;c='L' if c=='Z' else 'l';continue
        rel=c.islower();C=c.upper()
        if C in 'ML': a,b=float(t[i]),float(t[i+1]);i+=2;x,y=(x+a,y+b) if rel else (a,b)
        elif C=='H': a=float(t[i]);i+=1;x=x+a if rel else a
        elif C=='V': b=float(t[i]);i+=1;y=y+b if rel else b
        else: raise ValueError(f"fiducial path: {c} is not allowed, only straight segments")
        if C=='M': sx,sy=x,y;c='l' if rel else 'L'
        out.append((x,y))
    return out
def fbox(f):
    "bounding box of a fiducial's drawn geometry, in its own frame, stroke ignored"
    s=f.get('shape','circle')
    if s=='circle': r=f['d']/2;return (f['x']-r,f['y']-r,f['x']+r,f['y']+r)
    if s=='rect': return (f['x'],f['y'],f['x']+f['w'],f['y']+f['h'])
    if s=='path': P=pathpts(f['path']);X=[p[0] for p in P];Y=[p[1] for p in P];return (min(X),min(Y),max(X),max(Y))
    B=[fbox(c) for c in f['parts']];return (min(b[0] for b in B),min(b[1] for b in B),max(b[2] for b in B),max(b[3] for b in B))
def fref(f,m):
    "reference point in board (file) coordinates: the centre of the bounding box, moved out of the die frame if it's in one"
    a,b,c,e=fbox(f);x,y=(a+c)/2,(b+e)/2
    if f.get('frame','board')=='board': return (x,y)
    d=m['die'];return (d['tx']+x,d['ty']-y)
# ---- 3. writer -------------------------------------------------------------
COL=dict(sig="#b8860b",pwr="#c0392b",gnd="#2e7d32")
def cls(net): return 'pwr' if net.startswith('VBUS') else 'gnd' if net=='GND' else 'sig'
def write(m,path):
    E=ET.Element
    root=E(f"{{{SVG}}}svg",nsmap={None:SVG,'wb':WB,'inkscape':INK})
    S=lambda p,t,**a:ET.SubElement(p,f"{{{SVG}}}{t}",{(q(k[3:]) if k.startswith('wb_') else k.replace('_','-')):str(v) for k,v in a.items()})
    root.set('viewBox',"-300 -500 12000 9100");root.set('width','1200');root.set('height','910')
    for k,v in dict(version="0.1",units="um",design=m['design'],rev=m['rev'],**{'rule-wire-gap':n(m['rules']['gap']),'rule-edge-clear':n(m['rules']['edge'])}).items(): root.set(q(k),v)
    if 'fid' in m['rules']: root.set(q('rule-fid-clear'),n(m['rules']['fid']))
    S(root,'title').text=f"Wire bond diagram: {m['design']} rev {m['rev']}"
    S(root,'style').text=("text{font-family:Helvetica,Arial,sans-serif;fill:#222}.h{font-size:150px;font-weight:bold}.t{font-size:105px}.s{font-size:78px;fill:#555}"
      ".sub{fill:#eef3ea;stroke:#9aa;stroke-width:8}.cu{fill:#d9a441}.die{fill:#c9ccd6;stroke:#667;stroke-width:6}.pad{fill:#f7f7fa;stroke:#445;stroke-width:4}"
      ".w{fill:none;stroke-linecap:round}.sig{stroke:#b8860b}.pwr{stroke:#c0392b}.gnd{stroke:#2e7d32}.lab{font-size:62px;fill:#333}"
      ".zone{fill:#e67e22;fill-opacity:.45}.gd{fill:none;stroke:#222;stroke-width:8}.gdb{fill:#fff;stroke:#222;stroke-width:8}.mark{fill:#7b4fa0}")
    def fid(par,f):
        "a fiducial as drawn: circle, rect, straight-segment path, or a group of those"
        cl='cu' if f.get('frame','board')=='board' else 'mark'
        def shape(p,s,a):
            k=s.get('shape','circle')
            if k=='circle': return S(p,'circle',cx=n(s['x']),cy=n(s['y']),r=n(s['d']/2),**a)
            if k=='rect': return S(p,'rect',x=n(s['x']),y=n(s['y']),width=n(s['w']),height=n(s['h']),**a)
            if k=='path': return S(p,'path',d=s['path'],**a)
            g=S(p,'g',**{k:v for k,v in a.items() if k!='class'})
            for c in s['parts']: shape(g,c,{'class':cl})
            return g
        a={'class':cl,'wb_kind':'fiducial','wb_name':f['name'],'wb_role':f.get('role','align'),**({'wb_datum':f['datum']} if f.get('datum') else {})}
        e=shape(par,f,a)
        what='align: a machine may fit to it' if f.get('role','align')=='align' else 'orient: a mark for people'
        t=ET.Element(f"{{{SVG}}}title");t.text=f"{f['name']} fiducial, {what}"+(f", datum {f['datum']}" if f.get('datum') else "");e.insert(0,t)
    def layer(lbl,**a):
        g=S(root,'g',**a); g.set(f"{{{INK}}}groupmode",'layer'); g.set(f"{{{INK}}}label",lbl); return g
    def datum(par,k,x,y,ux,uy):
        "GD&T datum feature symbol: filled triangle on the feature at x,y, then a boxed letter along ux,uy"
        px,py=-uy,ux; bx,by=x+240*ux,y+240*uy
        S(par,'path',d=f"M{n(x+60*px)} {n(y+60*py)} L{n(x-60*px)} {n(y-60*py)} L{n(x+80*ux)} {n(y+80*uy)} Z",fill='#222')
        S(par,'line',x1=n(x+80*ux),y1=n(y+80*uy),x2=n(x+160*ux),y2=n(y+160*uy),**{'class':'gd'})
        S(par,'rect',x=n(bx-80),y=n(by-80),width=160,height=160,**{'class':'gdb'})
        S(par,'text',x=n(bx),y=n(by+37),text_anchor='middle',**{'class':'t'}).text=k
    h=S(root,'text',x=0,y=-220,**{'class':'h'}); h.text=f"{m['design']} rev {m['rev']}: top view (1 unit = 1 um, true scale)"
    B=m.get('board',dict(name='SUB',x=0,y=0,w=6000,h=6000))
    g=layer("substrate"); S(g,'rect',x=n(B['x']),y=n(B['y']),width=n(B['w']),height=n(B['h']),**{'class':'sub','wb_kind':'outline','wb_name':B['name']})
    for l in m['lands']:
        r=S(g,'rect',x=n(l['x']),y=n(l['y']),width=n(l['w']),height=n(l['h']),**{'class':'cu','wb_kind':'land','wb_name':l['name'],'wb_net':l['net'],'wb_finish':'ENIG'})
        S(r,'title').text=f"{l['name']} net {l['net']}"
    for f in m.get('fid',[]):
        if f.get('frame','board')=='board': fid(g,f)
    d=m['die']; g=S(root,'g',transform=f"translate({n(d['tx'])} {n(d['ty'])}) scale(1 -1)"); tol=m.get('tol')
    g.set(q('kind'),'die');g.set(q('name'),d['name']);g.set(q('gds-cell'),d['gds']);g.set(q('pad-layer'),d['layer'])
    if tol: g.set(q('place-tol'),n(tol['width']));g.set(q('datums'),tol['datums'])          # option A
    g.set(f"{{{INK}}}groupmode",'layer');g.set(f"{{{INK}}}label",'die')
    S(g,'rect',x=0,y=0,width=n(d['w']),height=n(d['h']),**{'class':'die','wb_kind':'outline'})
    for p in m['pads']:
        r=S(g,'rect',x=n(p['x']),y=n(p['y']),width=n(p['w']),height=n(p['h']),**{'class':'pad','wb_kind':'pad','wb_name':p['name'],'wb_net':p['net']})
        S(r,'title').text=f"U1 pad {p['name']} net {p['net']}"
    for f in m.get('fid',[]):
        if f.get('frame','board')==d['name']: fid(g,f)
    if tol:
        x0,y0,x1,y1=d['tx'],d['ty']-d['h'],d['tx']+d['w'],d['ty']; h=tol['width']/2; Z=layer("placement tolerance")
        R=lambda a:f"M{n(x0-a)} {n(y0-a)} H{n(x1+a)} V{n(y1+a)} H{n(x0-a)} Z"
        z=S(Z,'path',d=R(h)+' '+R(-h),fill_rule='evenodd',**{'class':'zone','wb_kind':'zone','wb_applies-to':d['name'],'wb_datums':tol['datums']})   # option C
        S(z,'title').text=f"Placement zone for {d['name']}: its outline stays inside this {n(tol['width'])} um band, datums {tol['datums']}"
        k=tol['datums'].split(); fx,fy,H=150,230,180; xs=[fx]
        for c in [200,240]+[160]*len(k): xs.append(xs[-1]+c)
        f=S(Z,'g',**{'wb_kind':'fcf','wb_applies-to':d['name'],'wb_char':'profile','wb_tol':n(tol['width']),'wb_datums':tol['datums']})          # option B
        S(f,'title').text=f"Profile of a surface, {n(tol['width'])} um total, datums {' | '.join(k)}, all around {d['name']}"
        S(f,'rect',x=fx,y=fy,width=xs[-1]-fx,height=H,**{'class':'gdb'})
        for x in xs[1:-1]: S(f,'line',x1=x,y1=fy,x2=x,y2=fy+H,**{'class':'gd'})
        S(f,'path',d=f"M{fx+40} {fy+125} A60 60 0 0 1 {fx+160} {fy+125} Z",**{'class':'gd'})
        for i,s in enumerate([n(tol['width'])]+k): S(f,'text',x=n((xs[i+1]+xs[i+2])/2),y=fy+H//2+37,text_anchor='middle',**{'class':'t'}).text=s
        lx=n(x0+50); S(f,'polyline',points=f"{xs[-1]},{fy+H//2} {lx},{fy+H//2} {lx},{n(y0-80)}",**{'class':'gd'})
        S(f,'circle',cx=lx,cy=fy+H//2,r=30,**{'class':'gd'}); S(f,'path',d=f"M{lx} {n(y0)} l-30 -80 h60 Z",fill='#222')
        for c in m.get('fid',[]):
            if not c.get('datum') or c.get('frame','board')!='board': continue
            a,b,e,f_=fbox(c);cx,cy=(a+e)/2,(b+f_)/2;sg=1 if cx<x0 else -1; datum(Z,c['datum'],cx+sg*(e-a)/2,cy,sg,0)
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
        r=S(g,'rect',x=n(s['x']),y=n(-(s['z']+s['t'])),width=n(s['w']),height=n(s['t']),style=sty[s['role']],**{'wb_kind':'layer','wb_name':s['name'],'wb_role':s['role'],'wb_material':s['material'],**({'wb_datum':s['datum']} if s.get('datum') else {})})
        S(r,'title').text=f"{s['name']}: {s['material']}, {n(s['t'])} um thick"+(f"; its top face is datum {s['datum']}" if s.get('datum') else "")
    for s in m['stack']:
        if s.get('datum'): datum(root,s['datum'],s['x']+450,Y0-(s['z']+s['t']),0,-1)
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
    if tol:   # placement panel, all derived from the model
        P=check(m)[0]['place']; L=place_limit(m); k=tol['datums'].split(); w=n(tol['width']); r=m['rules']
        dn=[f"{s['datum']} top of {s['name']} (section)" for s in m['stack'] if s.get('datum')]+[f"{f['datum']} fiducial {f['name']}" for f in m.get('fid',[]) if f.get('datum')]
        yy+=300; S(root,'text',x=X,y=yy,**{'class':'h'}).text="Die placement (proposed)"; yy+=170
        for c,s in (('t',"One rule, written three ways:"),
                    ('s',f"A. wb:place-tol=\"{w}\" wb:datums=\"{tol['datums']}\" on the die group"),
                    ('s',f"B. Feature control frame, top left: profile {w} | {' | '.join(k)}, all around"),
                    ('s',f"C. Orange band, {w} um wide: the die outline stays inside it"),
                    ('s',"Datums: "+", ".join(dn)),
                    ('t',"Checked at the edges of the band"),
                    ('s',f"Die moved {n(tol['width']/2)} um eight ways, and turned {P['turn']:.2f} deg each way"),
                    ('s',f"Worst die edge clearance {P['edge']:.0f} um (rule {n(r['edge'])}), wire gap {P['gap']:.0f} um (rule {n(r['gap'])})"),
                    ('t',"Largest error the checks allow"),
                    ('s',f"Bonder finds the die: {L['shift']:.1f} um or {L['turn']:.2f} deg, then {L['why']}"),
                    ('s',f"Bonder doesn't: {L['blind']:.1f} um, then {L['blind_why']}")):
            yy+=60 if c=='t' else 0
            S(root,'text',x=X,y=yy,**{'class':c}).text=s; yy+=150 if c=='t' else 120
    ET.ElementTree(root).write(path,xml_declaration=True,encoding='utf-8',pretty_print=True)
# ---- 4. reader -------------------------------------------------------------
def rd(path):
    t=ET.parse(path).getroot()
    A=lambda e,k:e.get(q(k)); F=lambda e,k:float(e.get(k))
    kinds=lambda k:[e for e in t.iter() if e.get(q('kind'))==k]
    d=kinds('die')[0]; tr=re.match(r"translate\(([-\d.]+) ([-\d.]+)\) scale\(1 -1\)",d.get('transform'))
    o=[c for c in d if c.get(q('kind'))=='outline'][0]
    m=dict(design=A(t,'design'),rev=A(t,'rev'),die=dict(name=A(d,'name'),w=F(o,'width'),h=F(o,'height'),tx=float(tr[1]),ty=float(tr[2]),gds=A(d,'gds-cell'),layer=A(d,'pad-layer')),
           rules=dict(gap=float(A(t,'rule-wire-gap') or 0),edge=float(A(t,'rule-edge-clear') or 0)))
    if A(t,'rule-fid-clear'): m['rules']['fid']=float(A(t,'rule-fid-clear'))
    sb=[e for e in kinds('outline') if not any(a.get(q('kind'))=='die' for a in e.iterancestors())]
    if sb: m['board']=dict(name=A(sb[0],'name'),x=F(sb[0],'x'),y=F(sb[0],'y'),w=F(sb[0],'width'),h=F(sb[0],'height'))
    R=lambda e:dict(name=A(e,'name'),net=A(e,'net'),x=F(e,'x'),y=F(e,'y'),w=F(e,'width'),h=F(e,'height'))
    m['pads']=[R(e) for e in kinds('pad')]; m['lands']=[R(e) for e in kinds('land')]
    m['stack']=[dict(name=A(e,'name'),role=A(e,'role'),material=A(e,'material'),z=-(F(e,'y')+F(e,'height')),t=F(e,'height'),x=F(e,'x'),w=F(e,'width'),**({'datum':A(e,'datum')} if A(e,'datum') else {})) for e in kinds('layer')]
    def shape(e):
        k=ET.QName(e).localname
        if k=='circle': return dict(shape='circle',x=F(e,'cx'),y=F(e,'cy'),d=2*F(e,'r'))
        if k=='rect': return dict(shape='rect',x=F(e,'x'),y=F(e,'y'),w=F(e,'width'),h=F(e,'height'))
        if k=='path': return dict(shape='path',path=e.get('d'))
        if k=='g': return dict(shape='g',parts=[shape(c) for c in e if ET.QName(c).localname in('circle','rect','path','g')])
        raise ValueError(f"fiducial {A(e,'name')}: a {k} can't be a fiducial")
    fid=[]
    for e in kinds('fiducial'):
        dg=[a for a in e.iterancestors() if a.get(q('kind'))=='die']
        f=dict(name=A(e,'name'),frame=A(dg[0],'name') if dg else 'board',role=A(e,'role') or 'align',**shape(e))
        if A(e,'datum'): f['datum']=A(e,'datum')
        fid.append(f)
    if fid: m['fid']=fid
    # placement tolerance: any one of the three forms is enough; the checker makes them agree
    tl={}; f=kinds('fcf'); z=kinds('zone')
    if A(d,'place-tol'): tl.update(width=float(A(d,'place-tol')),datums=A(d,'datums') or '')
    if f: tl['fcf']=(float(A(f[0],'tol')),A(f[0],'datums') or ''); tl.setdefault('width',tl['fcf'][0]); tl.setdefault('datums',tl['fcf'][1])
    if z:
        v=[float(x) for x in re.findall(r"-?\d+(?:\.\d+)?",z[0].get('d'))]; tl['zone']=v
        if len(v)==10: tl.setdefault('width',v[5]-v[0])
        tl.setdefault('datums',A(z[0],'datums') or '')
    if 'width' in tl: m['tol']=tl
    def num(v):
        v=float(v); return int(v) if v==int(v) else v
    m['prof']=[]
    for e in kinds('profile'):
        if A(e,'choice'):   # generic or undefined: no wire size or loop, so nothing to read but the name
            m['prof'].append(dict(name=A(e,'name'),choice=A(e,'choice'),d=None,moves='')); continue
        pl=[c for c in e if c.tag.endswith('polyline')][0]
        m['prof'].append(dict(name=A(e,'name'),material=A(e,'material'),d=num(pl.get('stroke-width')),style=A(e,'style'),dir=A(e,'dir'),moves=A(e,'moves'),interp=A(e,'interp'),refspan=num(A(e,'ref-span'))))
    m['wires']=[dict(name=A(e,'name'),frm=A(e,'from'),to=A(e,'to'),profile=A(e,'profile'),seq=int(A(e,'seq')),tier=int(A(e,'tier') or 1),net=A(e,'net') or '',x1=F(e,'x1'),y1=F(e,'y1'),x2=F(e,'x2'),y2=F(e,'y2'),sw=float(e.get('stroke-width'))) for e in kinds('wire')]
    return m
def segd(a,b,c,d):
    def p(pt,a,b):
        ax,ay=a;bx,by=b;l=(bx-ax)**2+(by-ay)**2;t=max(0,min(1,((pt[0]-ax)*(bx-ax)+(pt[1]-ay)*(by-ay))/l));return math.dist(pt,(ax+t*(bx-ax),ay+t*(by-ay)))
    def o(a,b,c): return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
    if o(a,b,c)*o(a,b,d)<0 and o(c,d,a)*o(c,d,b)<0: return 0
    return min(p(a,c,d),p(b,c,d),p(c,a,b),p(d,a,b))
def _check(m):
    out=[];d=m['die'];pads={f"{d['name']}.{p['name']}":p for p in m['pads']};lands={l['name']:l for l in m['lands']};pf={p['name']:p for p in m['prof']}
    S={s['role']:s for s in m['stack']};ztop=S['die']['z']+S['die']['t'];cap=S['mold']['z']+S['mold']['t'] if 'mold' in S else math.inf
    x0,y0,x1,y1=d['tx'],d['ty']-d['h'],d['tx']+d['w'],d['ty']
    res=dict(wires=len(m['wires']),pads=len(pads))
    mx=[];minedge=1e9;L=[]
    for w in m['wires']:
        p=pads[w['frm']];l=lands[w['to']];pr=pf[w['profile']]
        gx,gy=w['x1']-d['tx'],d['ty']-w['y1']
        if not(p['x']<=gx<=p['x']+p['w'] and p['y']<=gy<=p['y']+p['h']): out.append(f"{w['name']}: first bond off pad {w['frm']}")
        if not(l['x']<=w['x2']<=l['x']+l['w'] and l['y']<=w['y2']<=l['y']+l['h']): out.append(f"{w['name']}: second bond off land {w['to']}")
        if w['net']!=(p['net'] or '') or w['net']!=(l['net'] or ''): out.append(f"{w['name']}: net mismatch")
        if pr.get('choice'): continue   # no size or loop to check
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
    att=S.get('attach'); fl=(att['w']-d['w'])/2 if att else 0; lg=1e9   # attach fillet, taken as equal on all sides
    for l in m['lands']:
        g=(max(l['x']-x1-fl,x0-fl-l['x']-l['w'],0),max(l['y']-y1-fl,y0-fl-l['y']-l['h'],0))
        if g==(0,0): out.append(f"{l['name']}: under die or attach"); lg=min(lg,0)
        else: lg=min(lg,math.hypot(*g))
    res.update(length=(min(L),max(L)) if L else None,top=max(mx) if mx else None,cap=cap,edge=minedge,gap=gap,land=lg)
    return res,out
# ---- placement tolerance -----------------------------------------------------
# All of this assumes the bonder finds the die by vision: first bonds follow the die and second bonds follow the lands.
def shift(m,dx,dy,th):
    "the assembly as the die sees it after moving dx,dy and turning th: the die stays put and the board moves the other way"
    m=copy.deepcopy(m);d=m['die'];cx,cy=d['tx']+d['w']/2,d['ty']-d['h']/2;c,s=math.cos(th),math.sin(th)
    T=lambda x,y:(cx+c*(x-cx-dx)+s*(y-cy-dy),cy-s*(x-cx-dx)+c*(y-cy-dy))
    for w in m['wires']: w['x2'],w['y2']=T(w['x2'],w['y2'])
    for l in m['lands']:   # a turned land becomes its bounding box, which can only make clearances worse
        P=[T(x,y) for x in(l['x'],l['x']+l['w']) for y in(l['y'],l['y']+l['h'])];X=[p[0] for p in P];Y=[p[1] for p in P]
        l.update(x=min(X),y=min(Y),w=max(X)-min(X),h=max(Y)-min(Y))
    return m
def corners(m):
    "die positions at the edge of its zone: eight shifts of half the width, and the largest turn that keeps every corner inside"
    h=m['tol']['width']/2;d=m['die'];a,b=d['w']/2,d['h']/2;r=math.hypot(a,b)
    th=min(math.atan2(b,a)-math.acos(min(1,(a+h)/r)),math.atan2(a,b)-math.acos(min(1,(b+h)/r)))
    return [(f"{n(i*h)},{n(j*h)}",i*h,j*h,0) for i in(-1,0,1) for j in(-1,0,1) if i or j]+[(f"turn {g*math.degrees(th):+.2f} deg",0,0,g*th) for g in(1,-1)]
def box_gap(a,b):
    "gap between two boxes (x0,y0,x1,y1); 0 when they touch or overlap"
    return math.hypot(max(a[0]-b[2],b[0]-a[2],0),max(a[1]-b[3],b[1]-a[3],0))
def seg_box(p,r,b):
    "distance from segment p-r to box b; 0 when it enters the box"
    if any(b[0]<=x<=b[2] and b[1]<=y<=b[3] for x,y in(p,r)): return 0.0
    E=[((b[0],b[1]),(b[2],b[1])),((b[2],b[1]),(b[2],b[3])),((b[2],b[3]),(b[0],b[3])),((b[0],b[3]),(b[0],b[1]))]
    return min(segd(p,r,c,e) for c,e in E)
def fid_check(m):
    "F1 to F6 in SPEC.md. Returns a summary per frame, errors, warnings and notes."
    F=m.get('fid',[]);d=m['die'];out=[];warn=[];note=[];summ={}
    att={s['role']:s for s in m['stack']}.get('attach');fl=(att['w']-d['w'])/2 if att else 0
    x0,y0,x1,y1=d['tx'],d['ty']-d['h'],d['tx']+d['w'],d['ty']
    clr=m['rules'].get('fid',0)
    pads={p['name']:p for p in m['pads']};bonded={w['frm'].split('.',1)[1] for w in m['wires']}
    for fr in ('board',d['name']):
        al=[f for f in F if f.get('frame','board')==fr and f.get('role','align')=='align']
        if len(al)<2: warn.append(f"F1 {fr}: {len(al)} align fiducial{'' if len(al)==1 else 's'}, so the bonding house picks its own")
        s=dict(align=len(al))
        if len(al)>=2:   # F4: the farthest-apart pair, and how far its find error is levered out to the bonds it carries
            P=[(fref(f,m),f) for f in al]
            (a,fa),(b,fb)=max(((P[i],P[j]) for i in range(len(P)) for j in range(i+1,len(P))),key=lambda ab:math.dist(ab[0][0],ab[1][0]))
            sp=math.dist(a,b);mid=((a[0]+b[0])/2,(a[1]+b[1])/2)
            bonds=[(w['x2'],w['y2']) for w in m['wires']] if fr=='board' else [(w['x1'],w['y1']) for w in m['wires']]
            far=max((math.dist(mid,p) for p in bonds),default=0)
            s.update(pair=f"{fa['name']} {fb['name']}",spacing=round(sp,1),lever=round(far/sp,3))
            if fr!='board':   # F5: two of a kind, point-symmetric about the die centre
                ba,bb=fbox(fa),fbox(fb)
                same=fa.get('shape','circle')==fb.get('shape','circle') and abs((ba[2]-ba[0])-(bb[2]-bb[0]))<1 and abs((ba[3]-ba[1])-(bb[3]-bb[1]))<1
                if same and math.dist(mid,(d['tx']+d['w']/2,d['ty']-d['h']/2))<1:
                    warn.append(f"F5 {fr}: {fa['name']} and {fb['name']} look alike and sit opposite each other, so a die turned 180 deg looks the same to them")
        summ[fr]=s
    for f in F:
        b=fbox(f)
        if f.get('frame','board')=='board':
            B=m.get('board')
            if B and not(B['x']<=b[0] and b[2]<=B['x']+B['w'] and B['y']<=b[1] and b[3]<=B['y']+B['h']): out.append(f"F2 {f['name']}: not inside the substrate outline")
            if box_gap(b,(x0-fl,y0-fl,x1+fl,y1+fl))==0: out.append(f"F2 {f['name']}: under the die or its attach fillet")
            for l in m['lands']:
                g=box_gap(b,(l['x'],l['y'],l['x']+l['w'],l['y']+l['h']))
                if g==0 or g<clr: out.append(f"F3 {f['name']}: land {l['name']} is {g:.0f} um away (rule {n(clr)})")
            for w in m['wires']:
                g=seg_box((w['x1'],w['y1']),(w['x2'],w['y2']),b)
                if g==0 or g<clr: out.append(f"F3 {f['name']}: wire {w['name']} is {g:.0f} um away (rule {n(clr)})")
        else:
            if not(0<=b[0] and b[2]<=d['w'] and 0<=b[1] and b[3]<=d['h']): out.append(f"F2 {d['name']}.{f['name']}: not inside the die outline")
            for k,p in pads.items():
                if k in bonded and box_gap(b,(p['x'],p['y'],p['x']+p['w'],p['y']+p['h']))==0: note.append(f"F6 {d['name']}.{f['name']}: overlaps pad {k}, which gets a ball")
    return summ,out,warn,note
def check(m):
    res,out=_check(m);t=m.get('tol')
    fs,fo,fw,fn=fid_check(m);res['fid']=fs;out+=fo
    if fw: res['warn']=fw
    if fn: res['note']=fn
    if not t: return res,out
    d=m['die'];h=t['width']/2;x0,y0,x1,y1=d['tx'],d['ty']-d['h'],d['tx']+d['w'],d['ty']
    if t.get('fcf') and t['fcf']!=(t['width'],t['datums']): out.append("placement: feature control frame disagrees with wb:place-tol")
    exp=[x0-h,y0-h,x1+h,y1+h,x0-h,x0+h,y0+h,x1-h,y1-h,x0+h]
    if t.get('zone') and (len(t['zone'])!=10 or max(abs(a-b) for a,b in zip(t['zone'],exp))>1e-3): out.append(f"placement: drawn zone is not {n(t['width'])} um wide around {d['name']}")
    have={s.get('datum') for s in m['stack']}|{f.get('datum') for f in m.get('fid',[])}
    out+=[f"placement: datum {k} is not on any element" for k in t['datums'].split() if k not in have]
    C=corners(m);P=dict(tol=t['width'],turn=math.degrees(C[-2][3]),edge=1e9,gap=1e9,land=1e9)
    for lbl,dx,dy,th in C:
        r,e=_check(shift(m,dx,dy,th)); out+=[f"placement {lbl}: {x}" for x in e]
        for k in('edge','gap','land'): P[k]=min(P[k],r[k])
    res['place']=P; return res,out
def place_limit(m,dirs=8):
    "largest die shift and turn that pass every check when the bonder finds the die, and the shift a blind bonder allows"
    fails=lambda dx,dy,th:_check(shift(m,dx,dy,th))[1]
    def most(f,hi):
        lo=0.0
        for _ in range(30):
            mid=(lo+hi)/2
            if f(mid): hi=mid
            else: lo=mid
        return lo
    s,a=min((most(lambda v:fails(v*math.cos(a),v*math.sin(a),0),2000),a) for a in (2*math.pi*i/dirs for i in range(dirs)))
    why=fails((s+1)*math.cos(a),(s+1)*math.sin(a),0)
    tu=min(most(lambda v:fails(0,0,g*v),0.5) for g in(1,-1))
    d=m['die'];pads={f"{d['name']}.{p['name']}":p for p in m['pads']};pf={p['name']:p for p in m['prof']}
    # blind: bond points stay where they were programmed, so each ball (drawn at 1.3 d radius) must stay on its pad
    bl,bw=min((min(gx-p['x'],p['x']+p['w']-gx,gy-p['y'],p['y']+p['h']-gy)-1.3*pf[w['profile']]['d'],w['name']) for w in m['wires'] for p,gx,gy in [(pads[w['frm']],w['x1']-d['tx'],d['ty']-w['y1'])])
    return dict(shift=s,why=why[0] if why else '',turn=math.degrees(tu),blind=bl,blind_why=f"{bw}: ball leaves its pad")
def canon(m):
    def clean(w): return {k:v for k,v in w.items() if k!='sw'}
    x=dict(m);x['wires']=[clean(w) for w in m['wires']]
    if 'tol' in m: x['tol']={k:v for k,v in m['tol'].items() if k in('width','datums')}
    return x
def export(m,base):
    pf={p['name']:p for p in m['prof']};S={s['role']:s for s in m['stack']};ztop=S['die']['z']+S['die']['t']
    D=m['die'];cx,cy=D['tx']+D['w']/2,D['ty']-D['h']/2   # exports are centred on the die
    with open(base+'.bondlist.csv','w',newline='') as f:
        c=csv.writer(f);c.writerow("seq tier wire net from to x1_um y1_um z1_um x2_um y2_um z2_um profile".split())
        for w in sorted(m['wires'],key=lambda w:w['seq']):
            c.writerow([w['seq'],w['tier'],w['name'],w['net'],w['frm'],w['to'],n(w['x1']-cx),n(cy-w['y1']),n(ztop),n(w['x2']-cx),n(cy-w['y2']),0,w['profile']])
    if m.get('fid'):   # reference points, in the bond list's die-centred, y-up frame
        with open(base+'.fiducials.csv','w',newline='') as f:
            c=csv.writer(f);c.writerow("frame name role datum x_um y_um".split())
            for fd in m['fid']:
                x,y=fref(fd,m);c.writerow([fd.get('frame','board'),fd['name'],fd.get('role','align'),fd.get('datum',''),n(x-cx),n(cy-y)])
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
    pl=sub.add_parser("place",help="how far the die can move or turn before a check fails"); pl.add_argument("file"); pl.add_argument("--dirs",type=int,default=72)
    a=p.parse_args(argv); m=rd(a.file)
    if a.cmd=="place":
        print(json.dumps(place_limit(m,a.dirs),indent=2)); return 0
    if a.cmd=="check":
        res,errs=check(m); print(json.dumps(res,indent=2))
        for x in res.get('note',[]): print("NOTE",x)
        for x in res.get('warn',[]): print("WARN",x)
        for x in errs: print("ERROR",x)
        print(f"{len(errs)} error(s)"); return 1 if errs else 0
    export(m,a.base); print("wrote",a.base+".bondlist.csv",a.base+".dxf"); return 0
if __name__=="__main__":
    sys.exit(main())
