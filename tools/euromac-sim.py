#!/usr/bin/env python3
"""
Euromac-Geometrie-Simulator
===========================
Validiert das neue Modell mit Klemm-Ring, Asymmetrie-Default
und Maschinenbahn-Versatz BEVOR es ins Tool einfliesst.
"""

# ============== EUROMAC MODELL (NEU) ==============
EUROMAC = {
    "label": "Euromac",

    # Welle physisch
    "WELLE_PHYSISCH_MM": 1320,            # Gesamt-Wellen-Bestueckungsbereich
    "WELLE_LEFT_OF_GEO_CENTER": 650,      # links der Wellen-Mitte
    "WELLE_RIGHT_OF_GEO_CENTER": 670,     # rechts der Wellen-Mitte (asymmetrisch)

    # Default-Bestueckung (immer drauf)
    "KLEMM_DISTANZRING_MM": 5,            # Klemm-Distanzring im Gewinde (links)
    "KLEMM_SEITE": "left",
    "ASYMMETRY_RING_RIGHT_MM": 20,        # 20er-Default rechts (Asymmetrie-Ausgleich)
    "ASYMMETRY_RING_DEFAULT_ON": True,

    # Operativ nutzbar (zwischen Klemm und Asymmetrie-Ring)
    "BESTUECKUNGS_BREITE_OPERATIV": 1300, # = 650 (links) + 650 (rechts mit 20er Default)

    # Maschineneinbau
    "MASCHINEN_BAHN_OFFSET_MM": 15,       # Wellenmitte vs. Bahnmitte im Einbau
    "WELLE_REVERSED_ON_MOUNT": True,      # Welle gespiegelt eingebaut

    # Konstanten (unveraendert)
    "SCHNEIDEEINHEIT": 20,
    "SCHNITT_OFFSET": 11,                  # Schnittkante 11 mm v.l. der SE
    "DISTANZRINGE": [100, 50, 30, 20, 10, 5, 2, 1, 0.5, 0.3],
    "MAX_MR_MM": 1300,
    "MR_CENTER_OFFSET_STD": 20,           # MR-Bahn ±20 mm um Welle-Center
}


def distanzringe_for(ziel_mm, sortiment):
    """Greedy-Distanzring-Aufteilung (gross zuerst)."""
    rings = {}
    rest = ziel_mm
    tol = 0.001
    for r in sortiment:
        while rest >= r - tol:
            rings[r] = rings.get(r, 0) + 1
            rest -= r
    return rings, rest


def simulate_auftrag(name, mr_breite_mm, schmal_mm, anzahl_schmal):
    """
    Simuliert einen Bestueckungs-Plan auf der Euromac-Welle.

    Annahmen:
    - Mutterrolle wird zentriert auf der Welle gefuehrt (MR-Center = Welle-Mitte)
    - Anzahl Schmal-Rollen mit Breite schmal_mm
    - Anzahl SE = anzahl_schmal + 1 (eine SE links und rechts jeder Rolle)
    - Besaeumungs-Trim wird symmetrisch verteilt
    """
    M = EUROMAC
    print("=" * 72)
    print(f"AUFTRAG: {name}")
    print(f"Mutterrolle: {mr_breite_mm} mm | Schmal: {anzahl_schmal} x {schmal_mm} mm")
    print("=" * 72)

    # 1. Validierung
    if mr_breite_mm > M["MAX_MR_MM"]:
        print(f"FAIL: MR {mr_breite_mm} > Max {M['MAX_MR_MM']}")
        return False

    nutzen_total = anzahl_schmal * schmal_mm
    if nutzen_total > mr_breite_mm:
        print(f"FAIL: Schmal-Rollen {nutzen_total} > MR {mr_breite_mm}")
        return False

    # 2. Innere Bestueckung (Schmal-Rollen + SE dazwischen)
    n_se = anzahl_schmal + 1
    se_total = n_se * M["SCHNEIDEEINHEIT"]
    inner_len = nutzen_total + se_total
    print(f"Innere Bestueckung: {anzahl_schmal} Schmal + {n_se} SE = {inner_len} mm")

    # 3. Operative Bestueckung muss <= BESTUECKUNGS_BREITE_OPERATIV (1300) sein
    if inner_len > M["BESTUECKUNGS_BREITE_OPERATIV"]:
        print(f"FAIL: Innen {inner_len} > Operativ {M['BESTUECKUNGS_BREITE_OPERATIV']}")
        return False

    # 4. Besaeumungs-Trim aufteilen (symmetrisch um Welle-Mitte)
    rest_pro_seite = (M["BESTUECKUNGS_BREITE_OPERATIV"] - inner_len) / 2
    print(f"Trim/Besaeumung pro Seite: {rest_pro_seite} mm")

    # 5. Volle Bestueckungs-Sequenz von links nach rechts:
    #    [Klemm-5 | Trim-L | SE+R+SE+R+...+SE | Trim-R | Asymmetrie-20 ]
    seq = []
    pos = -M["KLEMM_DISTANZRING_MM"]  # Klemm sitzt vor 0 (auf Gewinde)
    seq.append(("Klemm-Ring",       M["KLEMM_DISTANZRING_MM"], pos, pos + M["KLEMM_DISTANZRING_MM"]))
    pos += M["KLEMM_DISTANZRING_MM"]

    # Trim links (Distanzringe)
    if rest_pro_seite > 0:
        rings, rest = distanzringe_for(rest_pro_seite, M["DISTANZRINGE"])
        if rest > 0.001:
            print(f"WARN: Trim-Rest links nicht abdeckbar: {rest:.3f} mm")
        ring_str = "+".join(f"{c}x{r}" for r, c in sorted(rings.items(), reverse=True))
        seq.append((f"Trim-L ({ring_str})", rest_pro_seite, pos, pos + rest_pro_seite))
        pos += rest_pro_seite

    # Innere Bestueckung
    for i in range(anzahl_schmal):
        seq.append((f"SE{i+1}", M["SCHNEIDEEINHEIT"], pos, pos + M["SCHNEIDEEINHEIT"]))
        pos += M["SCHNEIDEEINHEIT"]
        seq.append((f"R{i+1} ({schmal_mm}mm)", schmal_mm, pos, pos + schmal_mm))
        pos += schmal_mm
    seq.append((f"SE{anzahl_schmal+1}", M["SCHNEIDEEINHEIT"], pos, pos + M["SCHNEIDEEINHEIT"]))
    pos += M["SCHNEIDEEINHEIT"]

    # Trim rechts
    if rest_pro_seite > 0:
        rings, rest = distanzringe_for(rest_pro_seite, M["DISTANZRINGE"])
        if rest > 0.001:
            print(f"WARN: Trim-Rest rechts nicht abdeckbar: {rest:.3f} mm")
        ring_str = "+".join(f"{c}x{r}" for r, c in sorted(rings.items(), reverse=True))
        seq.append((f"Trim-R ({ring_str})", rest_pro_seite, pos, pos + rest_pro_seite))
        pos += rest_pro_seite

    # Asymmetrie-Ring rechts (Default 20 mm)
    seq.append(("Asymm-Ring-20", M["ASYMMETRY_RING_RIGHT_MM"], pos, pos + M["ASYMMETRY_RING_RIGHT_MM"]))
    pos += M["ASYMMETRY_RING_RIGHT_MM"]

    # 6. Ausgabe Sequenz
    print()
    print(f"{'#':<3} {'Element':<22} {'Breite':>8} {'Start':>8} {'Ende':>8}")
    print("-" * 60)
    for i, (lbl, w, s, e) in enumerate(seq, 1):
        print(f"{i:<3} {lbl:<22} {w:>8.1f} {s:>8.1f} {e:>8.1f}")

    # 7. Sanity-Checks
    print()
    print("VALIDIERUNG:")
    end_pos = seq[-1][3]
    expected = M["WELLE_PHYSISCH_MM"]  # 20er endet bei 1320 (= rechtes Welle-Ende)
    expected_with_klemm = expected + M["KLEMM_DISTANZRING_MM"]  # Sequenz-Total ab Klemm
    seq_total = expected_with_klemm
    print(f"  Sequenz-Endposition: {end_pos:.1f} mm (Soll: {expected})")
    print(f"  Sequenz-Total (inkl. Klemm): {seq_total:.1f} mm (Soll: {1325})")
    assert abs(end_pos - expected) < 0.01, f"END-Position falsch: {end_pos} != {expected}"

    # 8. Maschineneinbau
    print()
    print("MASCHINENEINBAU (Werker-Hinweis):")
    print(f"  Wellenmitte (operativ) = Position 650 mm in der Sequenz")
    print(f"  Welle wird gespiegelt eingebaut")
    print(f"  Im Einbau: Wellenmitte +{M['MASCHINEN_BAHN_OFFSET_MM']} mm zur Maschinenbahnmitte")
    print(f"  -> Messer in Position X auf der Welle = Bahnposition (X - 650 - 15) mm")
    print()

    return True


if __name__ == "__main__":
    # ===== Beispiel-Auftraege (analog DCM-Demos) =====
    cases = [
        # (Name,       MR-Breite, Schmal-Breite, Anzahl)
        ("Einfach-A",  1280,      320,           4),    # 4x320 + 5 SE
        ("Schmal-B",   1200,      29,            40),   # 40 sehr schmale + 41 SE = wird eng
        ("Mid-C",      1000,      80,            12),   # 12x80 + 13 SE
    ]

    for name, mr, schmal, n in cases:
        ok = simulate_auftrag(name, mr, schmal, n)
        if not ok:
            print(f"-> {name} FAEHRT NICHT")
        print()
