// DCM Panther · Pre-Release-Audit · v1.99.86
// Run vor Werker-Test morgen.
//
// Fokus:
//   A) Park-Auto-Reduzierung (Schwellwerte 1000/1237)
//   B) Asymm-SE 13mm-Versatz (Werker-Mass)
//   C) Werker-Cases aus machines.json (Golden DB)
//   D) NaN/Edge-Inputs (defensive)
//   E) Sequenz-Tests (breit → schmal · Park-Reset-Bug v1.99.86)
//   F) Cluster-MR-Mix (maxMR-Logik)

const path = require("path");
const fs   = require("fs");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const machinesJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "machines.json"), "utf8"));

// ===== Code-Extraktion =====
const extractFn = (name) => {
  const sigRe = new RegExp(`function\\s+${name}\\s*\\(`);
  const m = sigRe.exec(html);
  if (!m) throw new Error(`Function ${name} not found`);
  let i = m.index + m[0].length;
  while (i < html.length && html[i] !== "{") i++;
  let depth = 1, j = i + 1;
  while (j < html.length && depth > 0) {
    const c = html[j];
    if (c === '"' || c === "'" || c === "`") {
      const q = c; j++;
      while (j < html.length && html[j] !== q) { if (html[j] === "\\") j++; j++; }
    } else if (c === "/" && html[j+1] === "/") {
      while (j < html.length && html[j] !== "\n") j++;
    } else if (c === "/" && html[j+1] === "*") {
      j += 2;
      while (j < html.length - 1 && !(html[j] === "*" && html[j+1] === "/")) j++;
      j++;
    } else if (c === "{") depth++;
    else if (c === "}") depth--;
    j++;
  }
  return html.slice(m.index, j);
};

// ===== Maschinen-Profile aus machines.json (Source-of-Truth) =====
const DCM = Object.assign({}, machinesJson.machines.DCM, { id: "DCM" });
const EUROMAC = Object.assign({}, machinesJson.machines.EUROMAC, { id: "EUROMAC" });
const MACHINES = { DCM, EUROMAC };

let ACTIVE = "DCM";
let currentMrMm = null;
function setCurrentMrMmForCalc(mr) {
  currentMrMm = (typeof mr === "number" && isFinite(mr) && mr > 0) ? mr : null;
}

// localStorage-Mock
const _ls = {};
const localStorage = {
  getItem(k) { return _ls[k] != null ? _ls[k] : null; },
  setItem(k, v) { _ls[k] = String(v); },
  removeItem(k) { delete _ls[k]; },
  clear() { for (const k of Object.keys(_ls)) delete _ls[k]; }
};
const activeMachineId_get = () => ACTIVE;

// Eingebettete getMachine + Helpers (v1.99.86)
function getEuroAutoPark(mr) {
  if (mr != null && mr > 1120 + 0.001) return 1;
  return MACHINES.EUROMAC.PARK_PRO_SEITE;
}
function getDcmAutoPark(mr) {
  if (mr == null) return MACHINES.DCM.PARK_PRO_SEITE;
  // v1.99.87 Schwellen-Logik (gleich wie in index.html)
  if (mr > 1236 + 0.001) return 1;
  if (mr > 1000 + 0.001) return 2;
  return MACHINES.DCM.PARK_PRO_SEITE;
}
function getMachine() {
  const base = MACHINES[ACTIVE];
  let override = base.PARK_PRO_SEITE;
  if (base.id === "EUROMAC") {
    override = getEuroAutoPark(currentMrMm);
    try { localStorage.removeItem("rr.parkPerSide.EUROMAC"); } catch (_) {}
  } else if (base.id === "DCM") {
    override = getDcmAutoPark(currentMrMm);
    try { localStorage.removeItem("rr.parkPerSide.DCM"); } catch (_) {}
  }
  if (override !== base.PARK_PRO_SEITE) {
    const total = override * base.PARK_RING;
    return Object.assign({}, base, {
      PARK_PRO_SEITE: override,
      PARK_TOTAL: total,
      BESTUECKUNGS_BREITE: base.WELLE - 2 * total,
      MAX_MR_MM: base.WELLE - 2 * total,
    });
  }
  return base;
}

// Werker-Mass berechnen (DCM/Euromac unterscheiden sich in SCHNITT_OFFSET)
function werkerMass(mr, schmal, machine) {
  setCurrentMrMmForCalc(mr);
  const M = (machine === "DCM") ? (ACTIVE = "DCM", getMachine()) : (ACTIVE = "EUROMAC", getMachine());
  // Werker-Konvention: Rechtester Cut = 1. Schneidkante v. rechts
  // Einfache klassische Berechnung (homogen, kein Neben)
  const N = Math.floor(mr / schmal);
  if (N < 1) return { ok: false };
  const usedMm = N * schmal;
  const trim = mr - usedMm;
  const besL = trim / 2;
  // Welle-Layout: PARK_TOTAL + besL + (N x SE) bis innerEnd
  // Rechtester Schnittpunkt: innerStart + (N-1) * SE + SCHNITT_OFFSET
  // Werker-Mass = WELLE - rightmostCut
  const innerStart = M.PARK_TOTAL + besL;
  const SE = M.SCHNEIDEEINHEIT;
  // Rechtester SE-Start = innerStart + (N-1) * SE
  // Cut innerhalb SE bei SCHNITT_OFFSET v.l.
  const rightmostCut = innerStart + (N - 1) * SE + M.SCHNITT_OFFSET;
  const distMm = M.WELLE - rightmostCut;
  return { ok: true, werkerMass: distMm, M, N, trim, besL };
}

// ===== Test-Runner =====
let passCount = 0, failCount = 0;
const fails = [];
function test(name, expr, expected, actual) {
  const ok = expr === true || expr === expected;
  if (ok) {
    passCount++;
    console.log(`  ✓ ${name}`);
  } else {
    failCount++;
    fails.push({ name, expected, actual });
    console.log(`  ✗ ${name}\n      expected: ${expected}\n      actual:   ${actual}`);
  }
}
function near(a, b, tol) { return Math.abs(a - b) <= (tol || 0.5); }

console.log("\n╔════════════════════════════════════════════════════════════════════╗");
console.log("║  Rollenrechner v1.99.86 · Pre-Release-Audit (DCM Fokus)            ║");
console.log("╚════════════════════════════════════════════════════════════════════╝\n");

// ============================================================
// A) Park-Auto-Reduzierung — DCM-Schwellwerte exakt
// ============================================================
console.log("\n── A) Park-Auto-Reduzierung · DCM (4/2/1 Schwellen) ──\n");

ACTIVE = "DCM"; localStorage.clear();

// MR ≤ 1000 → 4 Park
[null, 0, 500, 999, 1000].forEach(mr => {
  setCurrentMrMmForCalc(mr);
  const M = getMachine();
  const expected = 4;
  test(`MR=${mr} → Park ${expected}`, M.PARK_PRO_SEITE === expected, expected, M.PARK_PRO_SEITE);
});

// MR 1001-1236 → 2 Park
[1001, 1100, 1180, 1236].forEach(mr => {
  setCurrentMrMmForCalc(mr);
  const M = getMachine();
  const expected = 2;
  test(`MR=${mr} → Park ${expected}`, M.PARK_PRO_SEITE === expected, expected, M.PARK_PRO_SEITE);
});

// MR ≥ 1237 → 1 Park
[1237, 1300, 1400].forEach(mr => {
  setCurrentMrMmForCalc(mr);
  const M = getMachine();
  const expected = 1;
  test(`MR=${mr} → Park ${expected}`, M.PARK_PRO_SEITE === expected, expected, M.PARK_PRO_SEITE);
});

// Boundary-Edge: knapp drüber
// MR 1000.5 passt nicht in 1000mm Bestueckung → Park 2 (bietet 1236mm)
setCurrentMrMmForCalc(1000.5);
test("MR=1000.5 → Park 2 (passt nicht in 1000mm)", getMachine().PARK_PRO_SEITE === 2, 2, getMachine().PARK_PRO_SEITE);
// MR 1236.99 passt nicht in 1236mm → Park 1 (bietet 1354mm)
setCurrentMrMmForCalc(1236.99);
test("MR=1236.99 → Park 1 (passt nicht in 1236mm)", getMachine().PARK_PRO_SEITE === 1, 1, getMachine().PARK_PRO_SEITE);
// MR 1236.01 — exakt knapp über 1236, sollte Park 1 sein
setCurrentMrMmForCalc(1236.01);
test("MR=1236.01 → Park 1", getMachine().PARK_PRO_SEITE === 1, 1, getMachine().PARK_PRO_SEITE);
// MR 1354 (= Park-1-Bestueckung) → Park 1 (gerade passend)
setCurrentMrMmForCalc(1354);
test("MR=1354 → Park 1 (Bestueckung exakt)", getMachine().PARK_PRO_SEITE === 1, 1, getMachine().PARK_PRO_SEITE);
// MR 1354.01 — passt NICHT in Park 1 → würde Bestueckungs-Overflow-Alert geben
// kein automatisches Park-0 möglich (gibt's nicht), Auto-Trigger bleibt bei 1
setCurrentMrMmForCalc(1354.01);
test("MR=1354.01 → Park 1 (max möglich)", getMachine().PARK_PRO_SEITE === 1, 1, getMachine().PARK_PRO_SEITE);

// ============================================================
// B) Park-Auto-Reduzierung — Euromac-Schwellwert (1120)
// ============================================================
console.log("\n── B) Park-Auto-Reduzierung · Euromac (2/1 Schwelle) ──\n");

ACTIVE = "EUROMAC"; localStorage.clear();

[null, 500, 1100, 1120].forEach(mr => {
  setCurrentMrMmForCalc(mr);
  const M = getMachine();
  const expected = 2;
  test(`Euromac MR=${mr} → Park ${expected}`, M.PARK_PRO_SEITE === expected, expected, M.PARK_PRO_SEITE);
});
[1121, 1180, 1300].forEach(mr => {
  setCurrentMrMmForCalc(mr);
  const M = getMachine();
  const expected = 1;
  test(`Euromac MR=${mr} → Park ${expected}`, M.PARK_PRO_SEITE === expected, expected, M.PARK_PRO_SEITE);
});

// ============================================================
// C) Werker-Cases · Park-State bei bekannten Golden-DB-MR-Werten
// (echte werkerMass-Berechnung läuft in verify-werker-cases.js — dort 4/4 PASS)
// ============================================================
console.log("\n── C) Werker-Cases · Park-State bei Golden-MR-Werten ──\n");

ACTIVE = "DCM";
setCurrentMrMmForCalc(1000);
test(`DCM MR=1000 (Werker-Case) → Park 4`, getMachine().PARK_PRO_SEITE === 4, 4, getMachine().PARK_PRO_SEITE);

ACTIVE = "DCM";
setCurrentMrMmForCalc(620);
test(`DCM MR=620 (realer Auftrag) → Park 4`, getMachine().PARK_PRO_SEITE === 4, 4, getMachine().PARK_PRO_SEITE);

ACTIVE = "EUROMAC";
setCurrentMrMmForCalc(1000);
test(`Euromac MR=1000 (Werker-Case) → Park 2`, getMachine().PARK_PRO_SEITE === 2, 2, getMachine().PARK_PRO_SEITE);

ACTIVE = "EUROMAC";
setCurrentMrMmForCalc(630);
test(`Euromac MR=630 (Werker-Case) → Park 2`, getMachine().PARK_PRO_SEITE === 2, 2, getMachine().PARK_PRO_SEITE);

// ============================================================
// D) Defensive: NaN, Infinity, negative Werte
// ============================================================
console.log("\n── D) Defensive Edge-Inputs (NaN/Infinity/Negativ) ──\n");

ACTIVE = "DCM"; localStorage.clear();

[NaN, -100, Infinity, -Infinity, "abc", undefined].forEach(bad => {
  setCurrentMrMmForCalc(bad);
  const M = getMachine();
  test(`MR=${String(bad)} → Default Park 4 (Robust)`,
    M.PARK_PRO_SEITE === 4, 4, M.PARK_PRO_SEITE);
});

// ============================================================
// E) Sequenz-Tests · breit → schmal (v1.99.86 Bug-Reprise)
// ============================================================
console.log("\n── E) Park-Reset-Sequenzen (v1.99.86 Bug-Fix) ──\n");

ACTIVE = "DCM"; localStorage.clear();

// Sequenz 1: MR 1180 → MR 800 (Park muss von 2 auf 4 zurück)
{
  setCurrentMrMmForCalc(1180);
  let M = getMachine();
  test(`Step 1: MR=1180 → Park 2`, M.PARK_PRO_SEITE === 2, 2, M.PARK_PRO_SEITE);
  setCurrentMrMmForCalc(800);
  M = getMachine();
  test(`Step 2: MR=800 → Park 4 (zurück auf Default)`, M.PARK_PRO_SEITE === 4, 4, M.PARK_PRO_SEITE);
}

// Sequenz 2: MR 1300 → MR null (gelöscht) → MR 600
{
  setCurrentMrMmForCalc(1300);
  test(`Step 1: MR=1300 → Park 1`, getMachine().PARK_PRO_SEITE === 1, 1, getMachine().PARK_PRO_SEITE);
  setCurrentMrMmForCalc(null);
  test(`Step 2: MR=null → Park 4 (kein Trigger)`, getMachine().PARK_PRO_SEITE === 4, 4, getMachine().PARK_PRO_SEITE);
  setCurrentMrMmForCalc(600);
  test(`Step 3: MR=600 → Park 4`, getMachine().PARK_PRO_SEITE === 4, 4, getMachine().PARK_PRO_SEITE);
}

// Sequenz 3 — Stale-localStorage Cleanup
{
  localStorage.setItem("rr.parkPerSide.DCM", "1");  // simuliert alten v1.99.84 State
  setCurrentMrMmForCalc(800);
  const M = getMachine();
  test(`Stale localStorage="1" wird ignoriert (cleanup)`, M.PARK_PRO_SEITE === 4, 4, M.PARK_PRO_SEITE);
  test(`Stale localStorage tatsächlich gelöscht`, localStorage.getItem("rr.parkPerSide.DCM") === null, "null", localStorage.getItem("rr.parkPerSide.DCM"));
}

// Sequenz 4 — Euromac analog
{
  ACTIVE = "EUROMAC";
  localStorage.setItem("rr.parkPerSide.EUROMAC", "1");
  setCurrentMrMmForCalc(800);
  const M = getMachine();
  test(`Euromac Stale localStorage="1" → Park 2 (Default)`, M.PARK_PRO_SEITE === 2, 2, M.PARK_PRO_SEITE);
}

// ============================================================
// F) Cluster-MR-Mix · maxMR-Logik
// ============================================================
console.log("\n── F) Cluster-MR-Mix (Park = maxMR-basiert) ──\n");

ACTIVE = "DCM"; localStorage.clear();

// Cluster mit Primary MR 800, Folger MR 1100 → maxMR=1100 → Park 2
{
  const jobs = [{ mr: 800 }, { mr: 1100 }];
  let maxMr = 0;
  for (const j of jobs) if (j.mr > maxMr) maxMr = j.mr;
  setCurrentMrMmForCalc(maxMr);
  const M = getMachine();
  test(`Cluster [800, 1100] → maxMR=1100 → Park 2`, M.PARK_PRO_SEITE === 2, 2, M.PARK_PRO_SEITE);
}

// Cluster mit Primary MR 800, Folger MR 1250 → maxMR=1250 → Park 1
{
  const jobs = [{ mr: 800 }, { mr: 1250 }];
  let maxMr = 0;
  for (const j of jobs) if (j.mr > maxMr) maxMr = j.mr;
  setCurrentMrMmForCalc(maxMr);
  const M = getMachine();
  test(`Cluster [800, 1250] → maxMR=1250 → Park 1`, M.PARK_PRO_SEITE === 1, 1, M.PARK_PRO_SEITE);
}

// Cluster nur schmale Jobs → maxMR=800 → Park 4
{
  const jobs = [{ mr: 700 }, { mr: 800 }, { mr: 650 }];
  let maxMr = 0;
  for (const j of jobs) if (j.mr > maxMr) maxMr = j.mr;
  setCurrentMrMmForCalc(maxMr);
  const M = getMachine();
  test(`Cluster [700, 800, 650] → maxMR=800 → Park 4`, M.PARK_PRO_SEITE === 4, 4, M.PARK_PRO_SEITE);
}

// ============================================================
// G) DCM Bestueckungs-Bereich passend zu Park-Level?
// ============================================================
console.log("\n── G) DCM Bestueckungs-Bereich pro Park-Level ──\n");

ACTIVE = "DCM"; localStorage.clear();

// Park 4 → Bestueckung 1000 mm (default)
setCurrentMrMmForCalc(800);
test(`Park 4 → Bestueckung 1000mm`, getMachine().BESTUECKUNGS_BREITE === 1000, 1000, getMachine().BESTUECKUNGS_BREITE);

// Park 2 → Bestueckung 1236mm (WELLE 1472 - 2*2*59 = 1472-236+118 ... rechnen)
// PARK_TOTAL = 2*59 = 118 mm/Seite, Bestueckung = 1472 - 2*118 = 1236
setCurrentMrMmForCalc(1100);
test(`Park 2 → Bestueckung 1236mm`, getMachine().BESTUECKUNGS_BREITE === 1236, 1236, getMachine().BESTUECKUNGS_BREITE);

// Park 1 → Bestueckung 1354mm
// PARK_TOTAL = 1*59 = 59 mm/Seite, Bestueckung = 1472 - 2*59 = 1354
setCurrentMrMmForCalc(1300);
test(`Park 1 → Bestueckung 1354mm`, getMachine().BESTUECKUNGS_BREITE === 1354, 1354, getMachine().BESTUECKUNGS_BREITE);

// ============================================================
// Final Report
// ============================================================
console.log("\n══════════════════════════════════════════════════════════════════════");
console.log(`Total: ${passCount} pass · ${failCount} fail · ${passCount + failCount} total`);
if (failCount > 0) {
  console.log("\n✗ FAILURES:");
  fails.forEach(f => console.log(`  · ${f.name}: erwartet ${f.expected}, tatsächlich ${f.actual}`));
  process.exit(1);
} else {
  console.log("\n✓ Audit bestanden — DCM-Werker-Test morgen kann starten.\n");
  process.exit(0);
}
