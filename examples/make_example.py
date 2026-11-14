"""Build the illustrative example: synthetic GDS -> pad extraction -> example.wb.svg + exports."""
import math, os, sys
import gdstk
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import wbx

# ---- 1. synthetic source data -------------------------------------------------
DIE=2500.0
def make_gds(path):
    lib=gdstk.Library(unit=1e-6,precision=1e-9); c=lib.new_cell("EXAMPLE_DIE")
    c.add(gdstk.rectangle((0,0),(DIE,DIE),layer=0,datatype=0))
    pads=[];pitch=420;edge=110;k=1
    off=[-840,-420,0,420,840]
    nets={0:["GND","A0","A1","A2","A3"],1:["GND","B0","VBUS","B2","B3"],2:["GND","C0","C1","C2","C3"],3:["GND","D0","D1","D2","D3"]}
    for side in range(4):
        for i,o in enumerate(off):
            u=DIE/2+o; xy={0:(edge,u),1:(u,DIE-edge),2:(DIE-edge,DIE-u),3:(DIE-u,edge)}[side]
            net=nets[side][i]; s=210 if net=="VBUS" else 100
            c.add(gdstk.rectangle((xy[0]-s/2,xy[1]-s/2),(xy[0]+s/2,xy[1]+s/2),layer=37,datatype=0))
            c.add(gdstk.Label(f"{k}:{net}",xy,layer=53,texttype=0)); k+=1
    # eye points in top metal (81/0), like a wafer.space die: a QR-like mark bottom left and a triangle top right,
    # each named by a label on 81/10 so the extractor can tell them apart
    for x,y,s in ((30,128,42),(128,128,42),(30,30,42),(86,86,14),(100,58,14),(128,72,14),(156,30,14),(142,100,14)):
        c.add(gdstk.rectangle((x,y),(x+s,y+s),layer=81,datatype=0))
    c.add(gdstk.Label("QR",(100,100),layer=81,texttype=10))
    c.add(gdstk.Polygon([(DIE-30,DIE-30),(DIE-170,DIE-30),(DIE-30,DIE-170)],layer=81,datatype=0))
    c.add(gdstk.Label("TRI",(DIE-60,DIE-60),layer=81,texttype=10))
    lib.write_gds(path)
def extract_marks(path, die="U1"):
    "eye points: top metal shapes grouped by the nearest 81/10 label within 200 um"
    lib=gdstk.read_gds(path,unit=1e-6); c=lib.top_level()[0]
    labels=[l for l in c.labels if (l.layer,l.texttype)==(81,10)]; groups={l.text:[] for l in labels}
    for p in c.polygons:
        if (p.layer,p.datatype)!=(81,0): continue
        (a,b),(d,e)=p.bounding_box(); cx,cy=(a+d)/2,(b+e)/2
        l=min(labels,key=lambda l:math.dist(l.origin,(cx,cy)))
        if math.dist(l.origin,(cx,cy))<=200: groups[l.text].append(p)
    out=[]
    for name,ps in groups.items():
        def shape(p):
            pts=[tuple(map(float,v)) for v in p.points]; (a,b),(d,e)=p.bounding_box()
            if len(pts)==4 and all(x in(a,d) for x,_ in pts) and all(y in(b,e) for _,y in pts):
                return dict(shape="rect",x=a,y=b,w=d-a,h=e-b)
            return dict(shape="path",path="M"+" L".join(f"{wbx.n(x)},{wbx.n(y)}" for x,y in pts)+" Z")
        parts=sorted((shape(p) for p in ps),key=lambda s:(s.get('y',0),s.get('x',0)))
        f=dict(name=name,frame=die,role="align",**(parts[0] if len(parts)==1 else dict(shape="g",parts=parts)))
        out.append(f)
    return sorted(out,key=lambda f:f['name'])
def extract_gds(path):
    lib=gdstk.read_gds(path,unit=1e-6); c=lib.top_level()[0]; pads=[]
    labels=[l for l in c.labels if (l.layer,l.texttype)==(53,0)]
    for p in c.polygons:
        if (p.layer,p.datatype)!=(37,0): continue
        (a,b),(d,e)=p.bounding_box()
        l=[l for l in labels if a<=l.origin[0]<=d and b<=l.origin[1]<=e][0]
        num,net=l.text.split(':')
        pads.append(dict(name=num,net=net,x=a,y=b,w=d-a,h=e-b))
    pads.sort(key=lambda p:int(p['name'])); return pads
# ---- 2. assembly intent (would come from KiCad) --------------------------------
def build_model(pads, marks=()):
    tx,ty=1750.0,4250.0
    prof=[dict(name="STD25",material="Au",d=25,style="ball-wedge",dir="forward",moves="180/0 30/12% -20/35%",interp="spline",refspan=1000),
          dict(name="PWR33",material="Au",d=33,style="ball-wedge",dir="forward",moves="220/0 30/12% -30/40%",interp="spline",refspan=1000),
          dict(name="DOWN25",material="Au",d=25,style="ball-wedge",dir="forward",moves="110/0 25/20%",interp="spline",refspan=500)]
    m=dict(design="WBX example",rev="A",die=dict(name="U1",w=DIE,h=DIE,tx=tx,ty=ty,gds="EXAMPLE_DIE",layer="37/0"),pads=pads,
      stack=[dict(name="substrate",role="substrate",material="FR4/ENIG",z=-400,t=400,x=0,w=6000,datum="A"),
             dict(name="attach",role="attach",material="Ag epoxy",z=0,t=25,x=1730,w=2540),
             dict(name="U1",role="die",material="Si",z=25,t=280,x=1750,w=2500),
             dict(name="glob",role="mold",material="epoxy",z=0,t=800,x=900,w=4200)],
      # fid: our placeholder clear distance from a board fiducial to any land or wire
      prof=prof,rules=dict(gap=60,edge=40,fid=150),lands=[],wires=[],
      # board fiducials (draft): F1 and F2 at opposite corners for machines, also datums B and C for the placement
      # tolerance; P1 is for people, the die's QR corner goes toward it. The die's eye points come from the GDS.
      fid=[dict(name="F1",frame="board",role="align",datum="B",shape="circle",x=800,y=5200,d=500),
           dict(name="F2",frame="board",role="align",datum="C",shape="circle",x=5200,y=800,d=500),
           dict(name="P1",frame="board",role="orient",shape="circle",x=1450,y=4600,d=300),*marks],
      tol=dict(width=50,datums="A B C"))
    seq=1
    for p in pads:
        cx,cy=p['x']+p['w']/2,p['y']+p['h']/2
        fx,fy=tx+cx,ty-cy
        dx,dy=fx-3000,fy-3000
        hor=abs(dx)>abs(dy)
        dirx,diry=(math.copysign(1,dx),0) if hor else (0,math.copysign(1,dy))
        if p['net']=="GND":
            L=330; lx,ly=fx+dirx*L,fy+diry*L; s=(140,140); pr="DOWN25"
        else:
            R=2000
            t=(fx-3000)*1.33 if not hor else (fy-3000)*1.33
            lx,ly=(3000+dirx*R,3000+t) if hor else (3000+t,3000+diry*R)
            s=(420,170) if hor else (170,420)
            if p['net']=="VBUS": s=(420,300) if hor else (300,420)
            pr="PWR33" if p['net']=="VBUS" else "STD25"
        name="L"+p['name']
        m['lands'].append(dict(name=name,net=p['net'],x=lx-s[0]/2,y=ly-s[1]/2,w=s[0],h=s[1]))
        offs=[-52,52] if p['net']=="VBUS" else [0]
        for o in offs:
            ox,oy=(o,0) if not hor else (0,o)
            m['wires'].append(dict(name=f"W{seq:02d}",frm="U1."+p['name'],to=name,profile=pr,seq=seq,tier=2 if p['net']=="GND" else 1,net=p['net'],
                 x1=fx+ox,y1=fy+oy,x2=lx+ox,y2=ly+oy)); seq+=1
    return m

if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    make_gds("example.gds")
    m = build_model(extract_gds("example.gds"), extract_marks("example.gds"))
    wbx.write(m, "example.wb.svg")
    wbx.export(wbx.rd("example.wb.svg"), "example")
    print(wbx.check(wbx.rd("example.wb.svg")))
