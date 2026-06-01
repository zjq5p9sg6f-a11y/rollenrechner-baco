// Verify DCM orders (79 echte Aufträge 2021) gegen v1.94 Konvention
// SCHNITT_OFFSET = 13 mm v. welle-LINKS (asymmetrisch wegen Schneidring/Nutmesser)
// Cut welle-coord = SE_x_left + SCHNITT_OFFSET

const fs = require('fs');
const path = require('path');

const ORDERS_PATH = path.join(__dirname, '../../wellenbestueckung/test-data/baco-orders-2021-02-03.json');
const orders = JSON.parse(fs.readFileSync(ORDERS_PATH, 'utf8'));

// DCM Maschinen-Konstanten (1:1 aus rollenrechner/index.html v1.94)
const DCM = {
  WELLE: 1472,
  WELLE_MITTE: 736,
  BESTUECKUNGS_BREITE: 1000,
  PARK_RING: 59,
  PARK_PRO_SEITE: 4,
  PARK_TOTAL: 236,
  BAHN_MITTE_OFFSET_MM: 0,
  SCHNEIDEEINHEIT: 20,
  SCHNITT_OFFSET: 13,        // v.l. — asymmetrisch (10 Schneidring + 3 Übergang + 7 Nutmesser)
  BESAEUMUNG_MIN_SOFT: 2.5,
  BESAEUMUNG_MAX: 20,
  MAX_MR_MM: 1000,
};

function calcWelleLayout(mr, haupt) {
  if (!mr || !haupt) return { ok: false, error: 'fehlende-werte' };
  if (mr > DCM.MAX_MR_MM) return { ok: false, error: `mr-${mr}-zu-breit` };
  if (haupt < DCM.SCHNEIDEEINHEIT) return { ok: false, error: 'schmal<SE' };

  const nutzen = Math.floor(mr / haupt);
  if (nutzen < 1) return { ok: false, error: 'nutzen<1' };

  const stack = nutzen * haupt;
  const restMM = mr - stack;
  if (restMM < 0) return { ok: false, error: 'restMM-negativ' };

  // Symmetrisch
  const trimL = restMM / 2;
  const trimR = restMM / 2;
  const haveSeL = trimL >= DCM.BESAEUMUNG_MIN_SOFT;
  const haveSeR = trimR >= DCM.BESAEUMUNG_MIN_SOFT;
  const SE = DCM.SCHNEIDEEINHEIT;
  const SCHNITT = DCM.SCHNITT_OFFSET;
  const distLExt = haveSeL ? 0 : (SE - SCHNITT);
  const distRExt = haveSeR ? 0 : (SE - SCHNITT);

  // innerSegs bauen
  const segs = [];
  if (haveSeL) segs.push({ kind: 'schneid', breite: SE, role: 'trim-L' });
  for (let i = 0; i < nutzen; i++) {
    const isFirst = i === 0;
    const isLast = i === nutzen - 1;
    const distBase = haupt - SE;
    const distBreite = distBase + (isFirst ? distLExt : 0);
    if (distBreite > 0.001) segs.push({ kind: 'distanz', breite: distBreite });
    const needSE = isLast ? haveSeR : true;
    if (needSE) {
      segs.push({ kind: 'schneid', breite: SE, role: isLast ? 'trim-R' : 'inner' });
    } else {
      const last = segs[segs.length - 1];
      if (last && last.kind === 'distanz') last.breite += distRExt;
    }
  }

  const innerLen = segs.reduce((s, x) => s + x.breite, 0);
  if (innerLen > DCM.BESTUECKUNGS_BREITE + 0.01) {
    return { ok: false, error: `innerLen-${innerLen.toFixed(1)}-passt-nicht` };
  }

  const restTotal = DCM.BESTUECKUNGS_BREITE - innerLen;
  const bahnOffset = DCM.BAHN_MITTE_OFFSET_MM;
  const restL = restTotal / 2 + bahnOffset;
  const restR = restTotal / 2 - bahnOffset;
  const innerStart = restL + DCM.PARK_TOTAL;

  // Cut-Positionen (Konv A: SE_x_left + SCHNITT_OFFSET)
  let cur = innerStart;
  const cuts = [];
  for (const seg of segs) {
    if (seg.kind === 'schneid') {
      cuts.push({ welle: cur + SCHNITT, role: seg.role });
    }
    cur += seg.breite;
  }

  const leftmostCut = Math.min(...cuts.map(c => c.welle));
  const rightmostCut = Math.max(...cuts.map(c => c.welle));
  const cutMitte = (leftmostCut + rightmostCut) / 2;
  const werkerMassRight = DCM.WELLE - rightmostCut;

  return {
    ok: true,
    nutzen, stack, restMM,
    trimL, trimR, haveSeL, haveSeR,
    innerLen, restL, restR, innerStart,
    seCount: cuts.length,
    leftmostCut, rightmostCut, cutMitte,
    werkerMassRight,
    cutMitteVsWelleMitte: cutMitte - DCM.WELLE_MITTE,  // 3 mm rechts wegen DCM-Asymm. erwartet
  };
}

console.log('═══════════════════════════════════════════════════════════════');
console.log(' DCM-Verifikation · 79 Aufträge 2021 gegen v1.94 (SCHNITT=13)');
console.log('═══════════════════════════════════════════════════════════════\n');

const results = orders.map(o => ({
  o, r: calcWelleLayout(o.mr_breite_mm, o.schmal_breite_mm)
}));

const ok = results.filter(r => r.r.ok);
const errors = results.filter(r => !r.r.ok);

console.log(`Rechenbar:  ${ok.length}/${orders.length}`);
console.log(`Errors:     ${errors.length}/${orders.length}`);

const errReasons = {};
for (const e of errors) {
  errReasons[e.r.error] = (errReasons[e.r.error] || 0) + 1;
}
console.log('Error-Verteilung:', errReasons);

console.log('\n--- Cut-Mitte vs WELLE_MITTE (sollte ~ +3 mm sein bei Trim, weil DCM SCHNITT=13 statt 10) ---');
const cmDist = {};
for (const r of ok) {
  const key = r.r.cutMitteVsWelleMitte.toFixed(1);
  cmDist[key] = (cmDist[key] || 0) + 1;
}
console.log('Verteilung:', Object.entries(cmDist).sort((a,b)=>parseFloat(a[0])-parseFloat(b[0])).map(([k,v])=>`${k}mm: ${v}`).join(', '));

console.log('\n--- Werker-Mass (vom welle-rechts zur rechtesten Cut) Verteilung ---');
const wms = ok.map(r => r.r.werkerMassRight).sort((a,b)=>a-b);
console.log(`min=${wms[0].toFixed(1)} mm, max=${wms[wms.length-1].toFixed(1)} mm, ø=${(wms.reduce((s,v)=>s+v,0)/wms.length).toFixed(1)} mm`);

console.log('\n--- Sample-Aufträge (erste 10) ---');
for (let i = 0; i < Math.min(10, ok.length); i++) {
  const { o, r } = ok[i];
  console.log(`#${i+1}: MR=${o.mr_breite_mm} mm × ${o.schmal_breite_mm} mm`
    + ` → N=${r.nutzen}, Trim=${r.trimL.toFixed(1)}+${r.trimR.toFixed(1)}, SEs=${r.seCount}`
    + `, Werker-Mass=${r.werkerMassRight.toFixed(1)} mm`
    + `, Cut-Mitte=${r.cutMitte.toFixed(1)} (Δ=${r.cutMitteVsWelleMitte.toFixed(1)} von Welle-Mitte)`);
}

// Spezifischer Check: PDF vom 2026-05-08 (MR 620, 21×29) → erwartete rechteste Cut
console.log('\n--- Spezifisch: MR 620 × 21×29 (DCM-PDF 2026-05-08) ---');
const specific = calcWelleLayout(620, 29);
console.log(JSON.stringify(specific, null, 2));

// Sanity: kein "Welle-Pos überschreitet Bestück" o.ä.
console.log('\n--- Sanity-Checks ---');
const sanity = {
  rightmostCutInBestueckung: 0,
  cutMitteInValidRange: 0,
  innerLenInBestueckung: 0,
};
for (const r of ok) {
  if (r.r.rightmostCut < DCM.PARK_TOTAL + DCM.BESTUECKUNGS_BREITE) sanity.rightmostCutInBestueckung++;
  if (r.r.cutMitte >= DCM.PARK_TOTAL && r.r.cutMitte <= DCM.PARK_TOTAL + DCM.BESTUECKUNGS_BREITE) sanity.cutMitteInValidRange++;
  if (r.r.innerLen <= DCM.BESTUECKUNGS_BREITE) sanity.innerLenInBestueckung++;
}
console.log(`Rechteste Cut in Bestueckungs-Bereich: ${sanity.rightmostCutInBestueckung}/${ok.length}`);
console.log(`Cut-Mitte in Bestueckungs-Bereich:     ${sanity.cutMitteInValidRange}/${ok.length}`);
console.log(`innerLen passt in Bestueckung:         ${sanity.innerLenInBestueckung}/${ok.length}`);
