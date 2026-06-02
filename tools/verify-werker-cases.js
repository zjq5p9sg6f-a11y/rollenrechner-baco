// v1.95 Self-Test-Suite: 3 Werker-validierte Cases als Golden-DB.
// Schützt vor Regression bei Konventions-/Math-Änderungen.
//
// CASES:
//   1. Euromac 8×122 / MR 1000     → Werker-Mass = 182,0 mm (Werker-Beispiel #1)
//   2. Euromac 25×25 / MR 630      → Werker-Mass = 357,5 mm (Werker-Beispiel #2)
//   3. DCM 21×29 / MR 620          → Werker-Mass = 245,0 mm (Asymm-SE-Konvention)
//
// USAGE:   node tools/verify-werker-cases.js   (exit 0 = alle OK, exit 1 = Fehler)

const path = require("path");
const fs   = require("fs");

// ── Maschinen-Konfig (1:1 aus index.html v1.95) ────────────────────────
const MACHINES = {
  DCM: {
    id: "DCM", label: "DCM Panther",
    WELLE: 1472, WELLE_MITTE: 736,
    BESTUECKUNGS_BREITE: 1000,
    PARK_RING: 59, PARK_PRO_SEITE: 4, PARK_TOTAL: 236,
    BAHN_MITTE_OFFSET_MM: 0,
    SCHNEIDEEINHEIT: 20,
    SCHNITT_OFFSET: 13,        // v.l. — asymm (10 Schneidring + 3 Übergang + 7 Nutmesser)
    BESAEUMUNG_MIN_SOFT: 2.5,
    MAX_MR_MM: 1000,
  },
  EUROMAC: {
    id: "EUROMAC", label: "Euromac",
    WELLE: 1320, WELLE_MITTE: 650,
    BESTUECKUNGS_BREITE: 1120,
    PARK_RING: 50, PARK_PRO_SEITE: 2, PARK_TOTAL: 100,
    BAHN_MITTE_OFFSET_MM: -10,
    SCHNEIDEEINHEIT: 20,
    SCHNITT_OFFSET: 10,        // = SE-Mitte (symm)
    BESAEUMUNG_MIN_SOFT: 2.5,
    MAX_MR_MM: 1120,
  },
};

// ── Engine: kompakte Replik von calcWelleJob (nur Sym-Trim, kein Neben) ───────
function calcLayout(M, mr, schmal) {
  if (mr > M.MAX_MR_MM + 0.001) return { ok: false, err: "mr-zu-breit" };
  const nutzen = Math.floor(mr / schmal);
  if (nutzen < 1) return { ok: false, err: "nutzen<1" };

  const stack = nutzen * schmal;
  const restMM = mr - stack;
  const trimL = restMM / 2, trimR = restMM / 2;
  const haveSeL = trimL >= M.BESAEUMUNG_MIN_SOFT;
  const haveSeR = trimR >= M.BESAEUMUNG_MIN_SOFT;
  const SE = M.SCHNEIDEEINHEIT;
  const SCH = M.SCHNITT_OFFSET;
  const distLExt = haveSeL ? 0 : (SE - SCH);
  const distRExt = haveSeR ? 0 : (SE - SCH);

  const segs = [];
  if (haveSeL) segs.push({ kind: "schneid", breite: SE, role: "trim-L" });
  for (let i = 0; i < nutzen; i++) {
    const isFirst = i === 0, isLast = i === nutzen - 1;
    const distBase = schmal - SE;
    const distBreite = distBase + (isFirst ? distLExt : 0);
    if (distBreite > 0.001) segs.push({ kind: "distanz", breite: distBreite });
    const needSE = isLast ? haveSeR : true;
    if (needSE) {
      segs.push({ kind: "schneid", breite: SE, role: isLast ? "trim-R" : "inner" });
    } else {
      const last = segs[segs.length - 1];
      if (last && last.kind === "distanz") last.breite += distRExt;
    }
  }
  const innerLen = segs.reduce((s, x) => s + x.breite, 0);
  if (innerLen > M.BESTUECKUNGS_BREITE + 0.001) return { ok: false, err: "innerLen-zu-breit" };

  const restTotal = M.BESTUECKUNGS_BREITE - innerLen;
  const bahn = M.BAHN_MITTE_OFFSET_MM;
  const restL = restTotal / 2 + bahn;
  const restR = restTotal / 2 - bahn;
  const innerStart = restL + M.PARK_TOTAL;

  let cur = innerStart;
  const cuts = [];
  for (const s of segs) {
    if (s.kind === "schneid") cuts.push(cur + SCH);
    cur += s.breite;
  }
  const rightmostCut = Math.max(...cuts);
  const leftmostCut  = Math.min(...cuts);
  return {
    ok: true, nutzen, stack, restMM, restL, restR,
    innerLen, innerStart, innerEnd: cur,
    leftmostCut, rightmostCut,
    werkerMassRight: M.WELLE - rightmostCut,
    cutMitte: (leftmostCut + rightmostCut) / 2,
    cutMitteVsWelleMitte: ((leftmostCut + rightmostCut) / 2) - M.WELLE_MITTE,
  };
}

// ── Golden Cases ────────────────────────────────────────────────────────
const CASES = [
  {
    name: "Euromac 8 × 122 mm / MR 1000  (Werker-Beispiel #1)",
    machine: "EUROMAC", mr: 1000, schmal: 122,
    expect: {
      werkerMassRight: 182.0,         // 670 (WELLE_MITTE v. rechts) − 488 = 182
      nutzen:          8,
      restMM:          24,            // trim 12 + 12
      cutMitteVsWelleMitte: 0,        // symmetrisch
    },
    tol: 0.5,
  },
  {
    name: "Euromac 25 × 25 mm / MR 630   (Werker-Beispiel #2, halbe mm)",
    machine: "EUROMAC", mr: 630, schmal: 25,
    expect: {
      werkerMassRight: 357.5,
      nutzen:          25,
      restMM:          5,             // trim 2,5 + 2,5
      cutMitteVsWelleMitte: 0,
    },
    tol: 0.5,
  },
  {
    name: "DCM 8 × 122 mm / MR 1000    (asymm. SE, 3-mm-Versatz)",
    machine: "DCM", mr: 1000, schmal: 122,
    expect: {
      werkerMassRight: 245.0,         // 1472 − 1227 (= SE_x_left + 13)
      nutzen:          8,
      restMM:          24,            // trim 12 + 12
      cutMitteVsWelleMitte: 3,        // wegen SCHNITT_OFFSET=13 ≠ SE/2=10
    },
    tol: 0.5,
  },
  {
    name: "DCM 21 × 29 mm / MR 620     (reale Auftrags-Math, kein Werker-Test)",
    machine: "DCM", mr: 620, schmal: 29,
    expect: {
      werkerMassRight: 428.5,         // (1472 − 1043.5) — durchgerechnet aus PDF 2026-05-08
      nutzen:          21,
      restMM:          11,            // trim 5,5 + 5,5
      cutMitteVsWelleMitte: 3,
    },
    tol: 0.5,
  },
];

// ── Runner ──────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
const results = [];
console.log("\n╔════════════════════════════════════════════════════════════════╗");
console.log("║  Rollenrechner Werker-Cases · Golden-DB Self-Test · v1.95     ║");
console.log("╚════════════════════════════════════════════════════════════════╝\n");

for (const c of CASES) {
  const M = MACHINES[c.machine];
  const r = calcLayout(M, c.mr, c.schmal);
  console.log(`▸ ${c.name}`);
  if (!r.ok) {
    console.log(`   ✗ FAIL — Engine-Error: ${r.err}\n`);
    fail++; results.push({ ...c, fail: true, err: r.err });
    continue;
  }
  let ok = true;
  const diffs = [];
  for (const [k, expected] of Object.entries(c.expect)) {
    const actual = r[k];
    const diff = Math.abs(actual - expected);
    const tol  = c.tol;
    const passed = diff <= tol;
    if (!passed) ok = false;
    diffs.push({ k, expected, actual, diff: diff.toFixed(2), passed });
  }
  if (ok) {
    console.log(`   ✓ PASS  werkerMass=${r.werkerMassRight.toFixed(1)} mm · nutzen=${r.nutzen} · restMM=${r.restMM.toFixed(1)} · cutMitte-Δ=${r.cutMitteVsWelleMitte.toFixed(1)}\n`);
    pass++;
  } else {
    console.log(`   ✗ FAIL`);
    for (const d of diffs) {
      const mark = d.passed ? "✓" : "✗";
      console.log(`     ${mark} ${d.k}: erwartet ${d.expected}, gemessen ${d.actual} (Δ ${d.diff})`);
    }
    console.log("");
    fail++;
  }
  results.push({ ...c, ok, r, diffs });
}

console.log("─────────────────────────────────────────────────────────────────");
console.log(`Summary: ${pass} PASS · ${fail} FAIL · ${CASES.length} total\n`);

if (fail > 0) {
  console.error("✗ REGRESSION — Werker-Konventionen sind kaputt. Code-Änderung pruefen.");
  process.exit(1);
}
console.log("✓ Alle Werker-Cases bestanden. Sicher zu deployen.\n");
process.exit(0);
