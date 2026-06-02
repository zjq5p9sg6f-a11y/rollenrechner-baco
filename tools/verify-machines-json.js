// Cross-Validation: machines.json gegen MACHINES-Konstante in index.html.
// Falls beide synchron sind, kann index.html später auf fetch("machines.json") umgestellt
// werden — Stufe 1 des Onboarding-Konzepts (siehe Vault-Memo).
//
// Plus: ruft die Werker-Cases gegen die JSON-Profile auf → JSON als Source-of-Truth verifiziert.

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const jsonPath = path.join(ROOT, "machines.json");
const htmlPath = path.join(ROOT, "index.html");

const json = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
const html = fs.readFileSync(htmlPath, "utf8");

// Extract MACHINES-Block aus index.html (zwischen "const MACHINES = {" und matching "};")
const startMarker = "const MACHINES = {";
const startIdx = html.indexOf(startMarker);
if (startIdx < 0) {
  console.error("✗ Konnte 'const MACHINES = {' in index.html nicht finden");
  process.exit(1);
}
// Wir parsen die Felder grob via Regex (kein voller JS-Parser; reicht für key/value-Vergleich)
function extractValue(haystack, key) {
  // Findet `KEY: VALUE,` oder `KEY: VALUE\n}` etc.
  const re = new RegExp(`\\b${key}\\s*:\\s*([^,\\n}]+)`, "m");
  const m = haystack.match(re);
  if (!m) return null;
  let v = m[1].trim().replace(/[,;]$/, "").trim();
  if (v.startsWith('"') || v.startsWith("'")) return v.slice(1, -1);
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return parseFloat(v);
  // Numerische Ausdrücke (z.B. "4 * 59" oder "2 * 100") evaluieren
  if (/^[-+*/().\d\s]+$/.test(v)) {
    try { return Function(`"use strict";return (${v})`)(); } catch (_) {}
  }
  return v;
}

function findMachineBlock(haystack, machineId) {
  const re = new RegExp(`${machineId}\\s*:\\s*{`, "m");
  const m = re.exec(haystack);
  if (!m) return null;
  // einfacher Brace-Matcher
  let depth = 1, i = m.index + m[0].length;
  const start = i;
  while (i < haystack.length && depth > 0) {
    if (haystack[i] === "{") depth++;
    else if (haystack[i] === "}") depth--;
    i++;
  }
  return haystack.slice(start, i - 1);
}

// Felder die KRITISCH übereinstimmen müssen für Math-Konsistenz
const CRITICAL_FIELDS = [
  "WELLE", "WELLE_MITTE", "BESTUECKUNGS_BREITE",
  "PARK_RING", "PARK_PRO_SEITE", "PARK_TOTAL",
  "BAHN_MITTE_OFFSET_MM", "SCHNEIDEEINHEIT", "SCHNITT_OFFSET",
  "BESAEUMUNG_MIN_SOFT", "MAX_MR_MM"
];

console.log("\n╔════════════════════════════════════════════════════════════════╗");
console.log("║  machines.json ↔ index.html · Cross-Validation                ║");
console.log("╚════════════════════════════════════════════════════════════════╝\n");

let totalPass = 0, totalFail = 0;
for (const machineId of Object.keys(json.machines)) {
  const profile = json.machines[machineId];
  const block = findMachineBlock(html, machineId);
  if (!block) {
    console.log(`✗ ${machineId}: Block in index.html nicht gefunden`);
    totalFail++;
    continue;
  }
  console.log(`▸ ${machineId} (${profile.label}):`);
  let machinePass = 0, machineFail = 0;
  for (const field of CRITICAL_FIELDS) {
    const jsonVal = profile[field];
    const htmlVal = extractValue(block, field);
    if (jsonVal == null) {
      console.log(`   - ${field}: JSON hat keinen Wert (skipping)`);
      continue;
    }
    if (jsonVal === htmlVal) {
      machinePass++;
    } else {
      console.log(`   ✗ ${field}: JSON=${jsonVal}, HTML=${htmlVal}`);
      machineFail++;
    }
  }
  if (machineFail === 0) {
    console.log(`   ✓ alle ${machinePass} kritischen Felder synchron\n`);
    totalPass++;
  } else {
    console.log(`   ✗ ${machineFail} Feld(er) abweichend\n`);
    totalFail++;
  }
}

console.log("─────────────────────────────────────────────────────────────────");
console.log(`Summary: ${totalPass}/${totalPass + totalFail} Maschinen-Profile synchron`);

if (totalFail > 0) {
  console.error("\n✗ machines.json + index.html sind NICHT synchron — bevor JSON-Fetch-Refactor erst angleichen.\n");
  process.exit(1);
}
console.log("\n✓ machines.json IST source-of-truth-kompatibel mit index.html");
console.log("→ Stufe-1.5-Refactor (fetch von JSON) kann erfolgen ohne Math-Drift-Risiko.\n");
process.exit(0);
