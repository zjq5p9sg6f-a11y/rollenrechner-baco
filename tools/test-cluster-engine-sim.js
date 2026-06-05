// Cluster-Engine Closed-Loop-Simulation · v1.99.41
// Testet die Kompatibilitätsprüfung bei Folgeauftrag-Hinzufügen mit
// realistischen Werker-Szenarien + Edge-Cases. Zeigt für jeden Fall:
//   - reached/excluded Aufträge
//   - common cuts, MR-Versatz, asymmetric trim pro Folgeauftrag
//   - Engine-Reaktion bei kaputten Werten

const path = require("path");
const fs   = require("fs");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

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

// --- Maschinen-Mocks ---
const MACHINES = {
  DCM: {
    id: "DCM", WELLE: 1472, WELLE_MITTE: 736, BESTUECKUNGS_BREITE: 1000,
    PARK_RING: 59, PARK_PRO_SEITE: 4, PARK_TOTAL: 236,
    BAHN_MITTE_OFFSET_MM: 0, SCHNEIDEEINHEIT: 20, SCHNITT_OFFSET: 13,
    DISTANZRINGE: [300, 200, 100, 50, 30, 20, 10, 5, 2, 1, 0.5, 0.3],
    SE_SORTIMENT: [], MAX_MR_MM: 1000, BESAEUMUNG_MIN_SOFT: 2.5, BESAEUMUNG_MAX: 20
  },
  EUROMAC: {
    id: "EUROMAC", WELLE: 1320, WELLE_MITTE: 650, BESTUECKUNGS_BREITE: 1120,
    PARK_RING: 50, PARK_PRO_SEITE: 2, PARK_TOTAL: 100,
    BAHN_MITTE_OFFSET_MM: -10, SCHNEIDEEINHEIT: 20, SCHNITT_OFFSET: 10,
    DISTANZRINGE: [100, 50, 30, 20, 10, 5, 2, 1, 0.5, 0.3],
    SE_SORTIMENT: [], MAX_MR_MM: 1120, BESAEUMUNG_MIN_SOFT: 2.5, BESAEUMUNG_MAX: 20
  }
};
let ACTIVE = "DCM";
function getMachine() { return MACHINES[ACTIVE]; }
function distanzringeForMachine(ziel, machine) {
  const M = machine || getMachine();
  const tol = 0.001;
  const result = {};
  let rest = ziel;
  for (const r of M.DISTANZRINGE) {
    while (rest >= r - tol) { result[r] = (result[r] || 0) + 1; rest -= r; }
  }
  return { rings: result, rest };
}
function distanzringeForDCM(ziel) { return distanzringeForMachine(ziel, getMachine()); }

eval(extractFn("calcMasterWelle"));
eval(extractFn("resolveCluster"));

function mkJob(mr, haupt, neben) {
  const j = { mr, haupt, nebenSlots: [] };
  if (neben) j.nebenSlots = [{ breite: neben.b, anz: neben.a }];
  return j;
}

function fmtCase(jobs) {
  return jobs.map(j => `MR${j.mr}×${j.haupt}` + (j.nebenSlots.length ? `+${j.nebenSlots[0].anz}×${j.nebenSlots[0].breite}` : "")).join(" | ");
}

function runScenario(name, machineId, jobs, expectSuccess) {
  ACTIVE = machineId;
  const t0 = Date.now();
  const result = resolveCluster(jobs);
  const ms = Date.now() - t0;
  const masterOk = result.master && result.master.ok;
  const reachedN = (result.reached || []).length;
  const excludedN = (result.excluded || []).length;
  const totalN = jobs.length;

  let status = "  ";
  if (expectSuccess === "all") {
    // Special case: 0 oder 1 Job = "no-op" — master:null ist korrekt, reached muss alle drin haben
    if (totalN <= 1) {
      status = (reachedN === totalN) ? "✓ PASS" : "✗ FAIL";
    } else {
      status = (masterOk && reachedN === totalN && excludedN === 0) ? "✓ PASS" : "✗ FAIL";
    }
  } else if (expectSuccess === "partial") {
    status = (masterOk && reachedN >= 2 && excludedN > 0) ? "✓ PASS" : "✗ FAIL";
  } else if (expectSuccess === "fail") {
    status = (!masterOk) ? "✓ PASS" : "✗ FAIL";
  }

  const detail = masterOk
    ? `reached ${reachedN}/${totalN}, excluded ${excludedN}`
    : `KEINE Master-Lösung, ${excludedN} excluded`;

  console.log(`  [${machineId.padEnd(7)}] ${status}  ${ms.toString().padStart(3)}ms · ${name.padEnd(36)} · ${detail}`);

  // Asymm + Versatz details for reached jobs
  if (masterOk && result.master.validJobs && totalN >= 2) {
    for (const vj of result.master.validJobs) {
      const flags = [];
      if (vj.asymmetric) flags.push(`asymm L${vj.besaeumungL.toFixed(1)}/R${vj.besaeumungR.toFixed(1)}`);
      if (Math.abs(vj.versatz || 0) > 0.5) flags.push(`Δ${vj.versatz > 0 ? "+" : ""}${vj.versatz.toFixed(0)}mm`);
      if (flags.length) console.log(`            · A${vj.origIdx + 1} (MR${vj.mr}×${vj.haupt}): ${flags.join(", ")}`);
    }
  }
  if (excludedN > 0) {
    for (const ex of result.excluded) {
      console.log(`            · A${ex.origIdx + 1} ausgeschlossen (${ex.conflictCount} Konflikt${ex.conflictCount === 1 ? "" : "e"})`);
    }
  }
  return { status, masterOk, reachedN, excludedN, ms };
}

console.log("\n╔══════════════════════════════════════════════════════════════════════════════════╗");
console.log("║  Cluster-Engine Closed-Loop-Sim · Folgeauftrag-Kompatibilitätsprüfung           ║");
console.log("╚══════════════════════════════════════════════════════════════════════════════════╝\n");

let totalPass = 0, totalFail = 0;
const track = (r) => { if (r.status.includes("PASS")) totalPass++; else if (r.status.includes("FAIL")) totalFail++; };

console.log("══ A · Werker-Alltag: gleiche Schmal, variierende MR ══════════════════════════════\n");
track(runScenario("identisch (Trivial-Cluster)", "DCM", [mkJob(700,29), mkJob(700,29), mkJob(700,29)], "all"));
track(runScenario("MR-Variation ±40 mm", "DCM", [mkJob(700,29), mkJob(680,29), mkJob(720,29), mkJob(660,29), mkJob(740,29)], "all"));
track(runScenario("MR-Variation ±100 mm (extrem)", "DCM", [mkJob(700,29), mkJob(600,29), mkJob(800,29), mkJob(650,29), mkJob(750,29)], "all"));
track(runScenario("MR-Variation knapp Limit", "DCM", [mkJob(700,29), mkJob(799,29), mkJob(801,29)], "all"));

console.log("\n══ B · Heterogene Schmal-Breiten ══════════════════════════════════════════════════\n");
track(runScenario("Schmal 29 vs 35 (klein Δ)", "DCM", [mkJob(700,29), mkJob(700,35)], "fail")); // hauptbreite muss ≥SE sein, aber unterschiedliche Schmal = unterschiedliche Cut-Positionen
track(runScenario("Schmal 29 vs 50 (groß Δ)", "DCM", [mkJob(700,29), mkJob(700,50)], "fail"));
track(runScenario("Mixed Schmal 25/30/35 (3 verschieden)", "DCM", [mkJob(700,25), mkJob(700,30), mkJob(700,35)], "fail"));

console.log("\n══ C · Cluster-Skalierung 1-10 Folgeaufträge ══════════════════════════════════════\n");
track(runScenario("1 primary + 1 follower", "DCM", Array(2).fill().map(()=>mkJob(700,29)), "all"));
track(runScenario("1 primary + 4 followers", "DCM", Array(5).fill().map(()=>mkJob(700,29)), "all"));
track(runScenario("1 primary + 7 followers", "DCM", Array(8).fill().map(()=>mkJob(700,29)), "all"));
track(runScenario("1 primary + 9 followers (Max)", "DCM", Array(10).fill().map(()=>mkJob(700,29)), "all"));
track(runScenario("1 primary + 10 followers (>Max!)", "DCM", Array(11).fill().map(()=>mkJob(700,29)), "all"));

console.log("\n══ D · Mit Neben-Schmalrollen (heterogene Bestückung) ═══════════════════════════════\n");
track(runScenario("Primary+Neben, Folger identisch", "DCM",
  [mkJob(700,29,{b:60,a:2}), mkJob(700,29,{b:60,a:2}), mkJob(700,29,{b:60,a:2})], "all"));
track(runScenario("Primary mit Neben, Folger OHNE", "DCM",
  [mkJob(700,29,{b:60,a:2}), mkJob(700,29), mkJob(700,29)], "fail"));
track(runScenario("Variable Neben-Konstellation", "DCM",
  [mkJob(700,29,{b:60,a:2}), mkJob(700,29,{b:60,a:1}), mkJob(700,29,{b:50,a:2})], "fail"));

console.log("\n══ E · Euromac (1320 mm, Mitten-Render, SE 10/10) ═════════════════════════════════\n");
track(runScenario("Euromac homogen 5-Cluster", "EUROMAC", Array(5).fill().map(()=>mkJob(800,40)), "all"));
track(runScenario("Euromac MR-Var ±50 mm", "EUROMAC",
  [mkJob(800,40), mkJob(750,40), mkJob(850,40), mkJob(770,40), mkJob(830,40)], "all"));
track(runScenario("Euromac heterogen Schmal", "EUROMAC",
  [mkJob(800,40), mkJob(800,50)], "fail"));

console.log("\n══ F · Partial-Cluster (manche reached, manche excluded) ═══════════════════════════\n");
track(runScenario("3 kompatibel + 1 Bock-Job", "DCM",
  [mkJob(700,29), mkJob(680,29), mkJob(720,29), mkJob(700,55)], "partial"));
track(runScenario("Primary + 2 ok + 1 ok + 1 fail", "DCM",
  [mkJob(700,29), mkJob(710,29), mkJob(690,29), mkJob(700,29), mkJob(700,77)], "partial"));

console.log("\n══ G · Edge-Cases & Validierung ═══════════════════════════════════════════════════\n");
track(runScenario("Einzelner Job (kein Cluster nötig)", "DCM", [mkJob(700,29)], "all"));
track(runScenario("Leeres Array", "DCM", [], "all"));
track(runScenario("MR < SE (Schmal zu schmal)", "DCM",
  [mkJob(700,29), mkJob(700,19)], "fail"));
track(runScenario("MR < Nebenraum (N=0 für Folger)", "DCM",
  [mkJob(700,29), mkJob(120,29,{b:60,a:2})], "fail"));
track(runScenario("Mega-MR > Maschinen-Max", "DCM",
  [mkJob(700,29), mkJob(2000,29)], "fail"));

console.log("\n══ H · Realistic Vertriebs-Szenarien (Wiegand-Use-Cases) ═══════════════════════════\n");
// Identische Auftrag pro Woche - "Stamm-Bestückung"
track(runScenario("Stamm-Auftrag 4× pro Woche", "DCM",
  Array(4).fill().map(()=>mkJob(680,28)), "all"));
// Saison-Auftrag mit minimaler Variation
track(runScenario("Saison: 50 mm MR-Spanne", "DCM",
  [mkJob(700,29), mkJob(715,29), mkJob(685,29), mkJob(720,29), mkJob(690,29), mkJob(705,29)], "all"));
// Mischkalkulation: 2 Stammschmal, einer mit Spezial
track(runScenario("Hauptkunde + 2 Specials", "DCM",
  [mkJob(700,29), mkJob(700,29), mkJob(700,29), mkJob(700,41), mkJob(700,33)], "partial"));

console.log("\n──────────────────────────────────────────────────────────────────────────────────");
console.log(`Total: ${totalPass} pass, ${totalFail} fail (von ${totalPass+totalFail})`);
console.log(totalFail === 0 ? "\n✓ Engine bestanden — Folgeauftrag-Kompatibilitätsprüfung robust\n" : "\n✗ Engine hat Fehl-Reaktionen — bitte Cases mit ✗ FAIL prüfen\n");
process.exit(totalFail === 0 ? 0 : 1);
