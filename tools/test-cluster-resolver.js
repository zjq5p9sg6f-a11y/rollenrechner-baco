// Test: kann der Cluster-Resolver mehr als 3 Folgeaufträge auf eine Master-Welle projizieren?
// User-Report: bei <=3 Folgeaufträgen funktioniert es, bei 4+ schlägt es fehl.

const path = require("path");
const fs = require("fs");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

// Extract function via brace-matching (regex kann verschachtelte Bodies nicht)
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
      while (j < html.length && html[j] !== q) {
        if (html[j] === "\\") j++;
        j++;
      }
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

// Mock-Machine: DCM
const DCM = {
  id: "DCM", WELLE: 1472, WELLE_MITTE: 736, BESTUECKUNGS_BREITE: 1000,
  PARK_RING: 59, PARK_PRO_SEITE: 4, PARK_TOTAL: 236,
  BAHN_MITTE_OFFSET_MM: 0, SCHNEIDEEINHEIT: 20, SCHNITT_OFFSET: 13,
  DISTANZRINGE: [300, 200, 100, 50, 30, 20, 10, 5, 2, 1, 0.5, 0.3],
  SE_SORTIMENT: [],
  MAX_MR_MM: 1000, BESAEUMUNG_MIN_SOFT: 2.5, BESAEUMUNG_MAX: 20
};
function getMachine() { return DCM; }
function distanzringeForMachine(ziel, machine) {
  const M = machine || getMachine();
  const tol = 0.001;
  const result = {};
  let rest = ziel;
  for (const r of M.DISTANZRINGE) {
    while (rest >= r - tol) {
      result[r] = (result[r] || 0) + 1;
      rest -= r;
    }
  }
  return { rings: result, rest };
}
function distanzringeForDCM(ziel) { return distanzringeForMachine(ziel, getMachine()); }

// Inline calcMasterWelle
eval(extractFn("calcMasterWelle"));
eval(extractFn("resolveCluster"));

// Test-Cases: gleiche Schmal-Breite, leicht unterschiedliche MR → sollten gut clustern
function mkJob(mr, haupt) { return { mr, haupt, nebenSlots: [] }; }

const testCases = [
  // 1 Primary + 1 Folge
  { name: "1+1 (homogen)",   jobs: [mkJob(700, 29), mkJob(700, 29)] },
  // 1 Primary + 2 Folge
  { name: "1+2 (homogen)",   jobs: [mkJob(700, 29), mkJob(700, 29), mkJob(700, 29)] },
  // 1 Primary + 3 Folge — wo angeblich noch geht
  { name: "1+3 (homogen)",   jobs: [mkJob(700, 29), mkJob(700, 29), mkJob(700, 29), mkJob(700, 29)] },
  // 1 Primary + 4 Folge — wo es scheitert
  { name: "1+4 (homogen)",   jobs: [mkJob(700, 29), mkJob(700, 29), mkJob(700, 29), mkJob(700, 29), mkJob(700, 29)] },
  // 1 Primary + 5 Folge
  { name: "1+5 (homogen)",   jobs: [mkJob(700, 29), mkJob(700, 29), mkJob(700, 29), mkJob(700, 29), mkJob(700, 29), mkJob(700, 29)] },
  // Heterogen aber kompatibel: gleiche haupt, leicht andere MR
  { name: "1+4 (var MR)",    jobs: [mkJob(700, 29), mkJob(680, 29), mkJob(720, 29), mkJob(660, 29), mkJob(740, 29)] },
  // Voll heterogen — wahrscheinlich Konflikte
  { name: "1+4 (var haupt)", jobs: [mkJob(700, 29), mkJob(700, 35), mkJob(700, 50), mkJob(700, 25), mkJob(700, 40)] },
];

console.log("\n╔═══════════════════════════════════════════════════════════════════╗");
console.log("║  Cluster-Resolver Audit · Folgeaufträge 1-5                       ║");
console.log("╚═══════════════════════════════════════════════════════════════════╝\n");

for (const tc of testCases) {
  const result = resolveCluster(tc.jobs);
  const totalJobs = tc.jobs.length;
  const reachedCount = result.reached.length;
  const excludedCount = result.excluded.length;
  const masterOk = result.master && result.master.ok;
  const followers = totalJobs - 1;

  const status = masterOk
    ? (excludedCount === 0 ? "✓ alle " + totalJobs + " auf Master" : `⚠ ${reachedCount}/${totalJobs} auf Master · ${excludedCount} ausgeschlossen`)
    : "✗ KEINE Master-Lösung";
  console.log(`  ${tc.name.padEnd(22)} (${followers} Folgejobs): ${status}`);
  if (!masterOk && result.master && result.master.conflictDetails) {
    console.log(`     → ${result.master.conflictDetails}`);
  }
  if (excludedCount > 0) {
    for (const ex of result.excluded) {
      console.log(`     · ausgeschlossen: Job-${ex.origIdx} (${ex.conflictCount} Konflikte)`);
    }
  }
}
console.log();

// === Erweiterte Tests: realistische Vertriebs-Szenarien ===
console.log("\n  ──── Erweiterte realistische Tests ────\n");
const extra = [
  // 5 Folgeaufträge, gleiche Schmal, leicht andere MR — typisches Produktions-Szenario
  { name: "1+5 (homogen var-MR)", jobs: [mkJob(700, 29), mkJob(680, 29), mkJob(720, 29), mkJob(660, 29), mkJob(740, 29), mkJob(710, 29)] },
  // 6 Aufträge gleiche Geometrie
  { name: "1+6 (alle gleich)",    jobs: [mkJob(700, 29), mkJob(700, 29), mkJob(700, 29), mkJob(700, 29), mkJob(700, 29), mkJob(700, 29), mkJob(700, 29)] },
  // 7 Aufträge max-cluster
  { name: "1+7 (alle gleich)",    jobs: Array(8).fill().map(() => mkJob(700, 29)) },
  // 1+4 mit Neben-Slot
  { name: "1+4 mit Neben",        jobs: [
    { mr: 700, haupt: 29, nebenSlots: [{ breite: 60, anz: 2 }] },
    { mr: 700, haupt: 29, nebenSlots: [{ breite: 60, anz: 2 }] },
    { mr: 700, haupt: 29, nebenSlots: [{ breite: 60, anz: 2 }] },
    { mr: 700, haupt: 29, nebenSlots: [{ breite: 60, anz: 2 }] },
    { mr: 700, haupt: 29, nebenSlots: [{ breite: 60, anz: 2 }] }
  ] },
];
for (const tc of extra) {
  const result = resolveCluster(tc.jobs);
  const totalJobs = tc.jobs.length;
  const reachedCount = result.reached.length;
  const excludedCount = result.excluded.length;
  const masterOk = result.master && result.master.ok;
  const followers = totalJobs - 1;
  const status = masterOk
    ? (excludedCount === 0 ? "✓ alle " + totalJobs + " auf Master" : `⚠ ${reachedCount}/${totalJobs} auf Master · ${excludedCount} ausgeschlossen`)
    : "✗ KEINE Master-Lösung";
  console.log(`  ${tc.name.padEnd(28)} (${followers} Folgejobs): ${status}`);
  if (!masterOk && result.master && result.master.conflictDetails) {
    console.log(`     → ${result.master.conflictDetails.substring(0, 120)}...`);
  }
}
console.log();
