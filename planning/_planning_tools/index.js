/* Planning Docs Index — the registry. The ONLY content file for the index.
   Rendered by index.engine.js. Claude maintains this:
     - DERIVED (baked at gen time): touched (git date), branch, board {chapter,needs}.
     - STORED (judgment): status, group, pinned, archived, order.
   When the user hits "Copy registry for Claude", fold their {overrides,note} back in.
   See PROTOCOL.md → "The planning index". */

window.PLANS_BAKED = {
  title: "WBX Planning Index",
  at: "2026-11-09",
  branch: "main",
  groups: ["Toolchain"],
};

window.PLANS = [
  { id:"wire_bond_lifecycle", title:"Wire Bond Lifecycle", kind:"board", status:"discussion",
    group:"Toolchain", pinned:false, archived:false, order:0, branch:"main", touched:"2026-11-09",
    chapter:2, needs:4, needsAnchor:"WIRE_GEN",
    link:"../wire_bond_lifecycle/board.html", doc:"../wire_bond_lifecycle/plan.html",
    blurb:"From GDS through a generated KiCad kit and wire types to bonder outputs. GDS owns the die, KiCad owns the assembly, everything else is generated, and each stage works with partial data." },
];
