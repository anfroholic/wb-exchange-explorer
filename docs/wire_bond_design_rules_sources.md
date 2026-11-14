# Wire bond design rules: sources

Notes behind `docs/wire_bond_design_rules.svg` and the app's DRC rules panel, November 2026. Both take their defaults from the table in `app/js/rules.js`. For a plain-language introduction to the same rules, see the [wire bonding primer](primer/wire-bonding-primer.html).

Nobody on this team has bonded a die, and we have no bonding house. So each number below is labelled by how solid its source is, and only numbers read in a source this session carry a source. Anything else is marked as our placeholder.

| Tier | Meaning | Rules |
|---|---|---|
| Standard | Read in a published standard | 5 |
| Vendor guide | Read in a packaging house, vendor or bonding lab guide | 17 |
| Rule of thumb | Read as a rule of thumb in a published source | 1 |
| Placeholder | Ours, no source found | 5 |

## The rules

| Key | Rule | Value | Condition | Tier | Source | What I read |
|---|---|---|---|---|---|---|
| W1 | Wire length, longest | 6 mm | 25 µm Au ball; Table 2 gives 4.5, 5.0, 6.0, 7.0 mm for 17.5, 20, 25, 33 µm | Vendor | [Europractice 2024][ep] | Table 1: "Wire bond length: 6mm or less, only for 25um wire STD." Table 2 "Wire Length max. (mm)" by diameter. |
| W2 | Span per wire diameter | 100 × d | Molded packages, about sag and sweep | Rule of thumb | [US 5,923,092][pat] | "The 100-D rule is generally applied to determine the maximum allowable wire span length." It also says the industry maximum span was "about from 180 to 200 mil". |
| W3 | Wire angle from pad normal | 45° | 25 µm Au ball | Vendor | [Europractice 2024][ep] | Rule 10: "The angle between the bond wire and the normal through the middle of the bondpad should be maximum 45°." |
| W4 | Crossings | 0 | Single tier | Vendor | [Europractice 2024][ep] | Rule 9: "Crossing of bonding wires is not allowed." MIL-STD-883 TM 2010 3.2.2e allows crossings in multi-tier packages at two wire diameters clearance. |
| W5 | Wire to wire gap, plan | 60 µm | Ours | Placeholder | none | The WBX example rule. [CERN bond lab][cern] bonds 25 µm wire at 60 µm pitch, which is a pitch, not a gap. |
| W6 | Wire separation per diameter | 2 × d | Class S; class B is 1 × d | Standard | [MIL-STD-883G TM 2010.11][m2010] | 3.2.2a: reject "Any wire with a separation of less than two wire diameters to ... another wire" (class S); one diameter for class B. |
| S1 | Clearance over die edge | 40 µm | Ours | Placeholder | none | The WBX example rule. TM 2017 3.1.6a asks 1.0 mil within the first 5 mil of a ball bond. |
| S2 | Die edge clearance per diameter | 2 × d | Past 5 mil (ball) or 10 mil (wedge) from the bond | Standard | [MIL-STD-883G TM 2017.8][m2017] | 3.1.6b: after the first 5.0 mil, reject a wire "closer than two wire diameters to any non-common, uninsulated conductive surface (e.g. ... unpassivated edge of conductive die)". |
| S3 | Loop height, highest | 2540 µm | Maximum | Vendor | [Samtec 2017][sam] | Fine pitch wire bond table, H: "Maximum Wire Height 0.100" (2540)". |
| S4 | Glob top height | 600 µm, off by default | Set your own | Vendor | [Samtec 2017][sam] | "Maximum encapsulation thickness (board surface to top of encapsulation): 0.024" (600)". |
| S5 | Glob top cover over loop | 175 µm | Organic | Vendor | [Samtec 2017][sam] | Encapsulation table, D: "Overlap of Encapsulation to Top of Wire Bond Loop 0.007" (175)". |
| P1 | Pad opening, smallest side | 55 µm | 25 µm Au ball; 40, 46, 55, 70 µm for 17.5 to 33 µm | Vendor | [Europractice 2024][ep] | Table 1: "Bond pad opening Greater than 55µm x 55µm"; Table 2 "Pad size min." by diameter. |
| P2 | Pad opening per diameter | 3 × d | Gold ball | Vendor | [STFC][stfc] | "For gold wire, pad width should be a minimum of 3x the wire diameter. Standard 25µm diameter wire min. 75µm sq. pad." Europractice's table works out near 2.2 × d, so the two disagree. |
| P3 | Pad opening, largest side | 300 µm | Ours | Placeholder | none | A sanity check on pad finding, matching the pad finder's default upper size. Not a bonding limit. |
| P4 | Pad pitch | 65 µm | 25 µm Au ball; 50, 56, 65, 80 µm for 17.5 to 33 µm | Vendor | [Europractice 2024][ep] | Table 1: "Bond pad pitch Greater than 65µm"; Table 2 "Pad Pitch min.". |
| P5 | Bonds on one pad or land | 2 | Per finger or pad | Vendor | [Europractice 2024][ep] | "Max. number of wires per package finger / pad: 2". |
| P6 | Spacing of bonds on one die pad | 75 µm | Ours: one 25 µm ball | Placeholder | none | No spacing found. TM 2010 3.2.1.4 note: "When by design, there are multiple bonds on a common bonding pad or post they may not reduce the width of an adjacent bond by more than 25 percent." The 75 µm is one ball at 3 × d. |
| L1 | Land, smallest side | 100 µm | Organic; ceramic 75 µm | Vendor | [Samtec 2017][sam] | Wire bond table, A: "Wire Bond Pad 0.004" (100) organic, 0.003" (75) ceramic". |
| L2 | Land pitch | 200 µm | Organic; ceramic 150 µm | Vendor | [Samtec 2017][sam] | "Wire Bond Pad Pitch 0.008" (200), 0.006" (150)". |
| L3 | Die edge to land | 375 µm or 2 × die thickness | No ground plane under the die | Vendor | [Samtec 2017][sam] | F: "Space of Die Edge to Wire Bond Lead Edge 0.015" (375) or 2x Die Thickness (whichever is greater)", "*Assumes no ground plane for die attach". |
| L4 | Spacing of bonds on one land | 300 µm | In line; tool dependent | Vendor | [CERN bond lab][cern] | "The minimum preferable in line distance between two bonds is 300µm", "tool dependant and to a certain extent loop dependant". |
| L5 | Glob top dam to land | 300 µm | Organic | Vendor | [Samtec 2017][sam] | Encapsulation table: dam width 300 µm; "Space of Dam to Wire Bond Lead Edge 0.012" (300)". Not enforced: no dam in the data. |
| D1 | Die to die, side by side | 250 µm | Minimum | Vendor | [Europractice 2024][ep] | "Die to die distance definition: 250µm minimum". |
| D2 | Stacked die step to a bonded pad | 250 µm | Ours | Placeholder | none | No source found for a step. Borrowed from D1. |
| K1 | Keepout to parts with height | 45° | Plus half the tool tip | Vendor | [STFC][stfc] | "Need at least 45 degree angle clearance on all sides", "Make sure components can fit under bond head". [CERN][cern] adds "additional tolerance, equal to half the capillary tip diameter". Not enforced: no part heights. |
| B1 | Ball bond diameter | 2 × d, to 5 × d | Gold ball | Standard | [MIL-STD-883G TM 2010.11][m2010] | 3.2.1.1a: reject ball bonds "less than 2.0 times or greater than 5.0 times the wire diameter". Same in TM 2017 3.1.5.1. Not enforced: no bond footprint. |
| B2 | Wedge bond width | 1.2 × d, to 3 × d | Ultrasonic | Standard | [MIL-STD-883G TM 2010.11][m2010] | 3.2.1.2a: ultrasonic wedge "less than 1.2 times or more than 3.0 times the wire diameter in width, or less than 1.5 times or more than 6.0 times ... in length"; thermosonic 1.5 to 3.0 × d. Not enforced. |
| B3 | Bond inside pad opening | 75% | Class S; class B 50% | Standard | [MIL-STD-883G TM 2010.11][m2010] | 3.2.1.4a: reject "Bonds on the die where less than 75 percent of the bond is within the unglassivated bonding pad area" (class S), 50% (class B). Not enforced; the app checks the bond point is on the pad. |

Values that depend on wire diameter or process: W1, P1 and P4 are quoted for 25 µm Au ball and scale with diameter per Europractice's Table 2. W2, W6, S2, P2, B1 and B2 are multiples of d. B1 is ball only, B2 wedge only. L1 and L2 differ for ceramic. L4 is for wedge bonds in line. S2 changes at 5 mil from a ball bond and 10 mil from a wedge bond.

## What "too long" means

No source gives one number, and they frame it four ways.

1. **Process limit, absolute.** Europractice: 6 mm for 25 µm Au ball, 4.5 to 7.0 mm across 17.5 to 33 µm wire. Samtec: 6.35 mm. This is a house's service limit for its wire and tool.
2. **Span over diameter, mechanical.** The 100-D rule from US 5,923,092 caps span at 100 wire diameters, 2.5 mm for 25 µm wire, because sag and mold sweep grow with span. That is far shorter than Europractice's 6 mm, because it comes from transfer molding. A glob top flows too, but less forcefully. A search result also cited a patent saying stresses go as the square of span over diameter; I didn't open it.
3. **Clearance.** Longer, lower wires sag towards the die edge and their neighbours. MIL-STD-883 sets clearance in wire diameters (S2, W6), and an inspector rejects the wire whatever its length.
4. **Electrical.** [Semiconductor Digest][sd]: 1 mil Au wire has "a resistance of 1.17 mΩ per mil of length" and "Typical inductance ... is 25 pH per mil length", about 46 mΩ and 1 nH per mm. Too long is whenever that matters to the signal.

So the app's length check states that it measures the straight plan distance from first bond to second, which is shorter than the real wire by its loop, against a vendor's service maximum for 25 µm Au. It runs on every wire, including those left to the bonder. W2 runs only on wires whose type gives a diameter.

I found no loop height to span ratio in a source.

## Read and not used as a default

| Source | What it says | Why not used |
|---|---|---|
| [LCSC blog][lcsc] | Gold ball pad 60 to 100 µm minimum, 80 to 120 recommended; Al wedge 60 × 90 µm minimum; pitch ≥ 50 µm; ball 2.5 to 5 × d; max length ≤ 5 mm; pad to conductor "10 mm", which is likely a typo | A blog, no stated source |
| [Altium, PCB design rules for COB][alt] | Land width "50 to 150 microns, with the same value being used for pad pitch" | Too loose to use as a rule |
| [Semiconductor Digest][sd] | Pads "a minimum of 10 mm from the edge of adjacent conductors"; component clearance "X is 0.01 in. > ¼ of the component height" | The first looks like a typo and the second came through garbled. The 45° rule was used for K1 instead |
| [STFC][stfc] | Wedge pad 100 × 125 µm at 175 µm pitch for 25 µm wire; bond foot 45 × 100 µm | Wedge only; kept as background for P2 and L4 |
| [CERN bond lab][cern] | 60 µm pitch possible with 25 µm wire, but the loop is limited in height | Used in W5's note |

## Looked for and not found

- **MIL-STD-883 wire length or sag limit.** TM 2010 and TM 2017 judge clearance and arc ("no arc" is a reject), not length.
- **Kulicke & Soffa, Palomar, Hesse, F&K Delvotec, Amkor and ASE design guides.** None came up as public documents. An Amkor stacked CSP datasheet is quoted second-hand as 40 µm minimum die pitch and 5 mm maximum wire length, but the copy I tried returned 403, so it isn't used.
- **JEDEC and IPC wire bond geometry rules.** None found in public text.
- **Stacked die step, multi-bond spacing on a die pad, and a pad size maximum.** No source; these are placeholders.
- **Cadence's "100 times the diameter" length constraint.** A search summary quoted it, but the page I fetched didn't contain it, so it isn't cited.

## Limits of these sources

- MIL-STD-883G is the 2004 revision on q-tech.com; the current revision may differ. Its numbers are visual inspection criteria for military microcircuits, not design rules.
- The Europractice document is marked "strictly confidential" but is publicly posted. Its numbers are for their packaging service, mostly ceramic and QFN.
- Samtec's are "guidelines designed to help release product to manufacturing as quickly as possible", for their own process.
- The STFC and CERN pages are bonding lab guidance, tool dependent by their own account.
- WebFetch read PDFs through a text extractor (`pdftotext -layout`); I read the extracted text, not the figures.

[ep]: https://europractice-ic.com/wp-content/uploads/2020/06/ASIC_Prototype_Packaging_Design_Rules_2024.pdf
[sam]: https://suddendocs.samtec.com/literature/advanced-package-design-guidlines.pdf
[m2010]: https://q-tech.com/wp-content/uploads/STD-883-2010.pdf
[m2017]: https://q-tech.com/wp-content/uploads/STD-883-2017.pdf
[stfc]: https://indico.global/event/1886/contributions/31130/attachments/15938/25564/Wire%20bond%20requirement10.pdf
[cern]: https://bondlab.web.cern.ch/Recommendations.html
[pat]: https://patents.google.com/patent/US5923092A/en
[sd]: https://sst.semiconductor-digest.com/?p=36674
[lcsc]: https://www.lcsc.com/blog/wire-bonding-pad-design-guide/
[alt]: https://resources.altium.com/p/pcb-design-rules-chip-board-layout
