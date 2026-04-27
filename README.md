# Rollenrechner · Ballerstaedt

Internes Single-Page-Tool für Maschinenführer an Längsschneidemaschinen (Euromac, DCM Panther). Berechnet aus Auftragsdaten alle Maschinen-Parameter inkl. Lean-Wertstrom-Diagnose.

## Was es kann

- **Geometrie**: Gesamt-LFM, Nutzen pro Mutterrolle, Restbesäumung (links + rechts dimensioniert), Produktion pro Satz, volle Sätze + Restsatz, bereitzustellende MR-Menge
- **Material**: Hülsenbedarf für die Brodbeck-Hülsenschneidemaschine
- **Zeit**: Netto-Schneiden, Brutto-Laufzeit, Per-Satz-Zyklus inkl. Handling
- **Lean-Diagnose**: Vier verschiedene Wertstrom-Hebel werden aktiv geflagt
- **Visualisierung**: SVG-Schnittspiegel mit CAD-Bemaßung
- **Einheiten**: mm/cm/m umschaltbar für Mutter- und Schmalrolle
- **Maschinen-Limits**: Hard cap 1300 mm MR (Euromac), Soft-Warn ab 1000 mm (DCM Panther)
- **Offline**: Single-File HTML, keine externen Dependencies

## Lean-Diagnose-Schwellen

| Schwelle | Diagnose | Empfehlung |
|---|---|---|
| Zykluszeit < 3 min | Operator-Takt überfordert | Helfer / LFM erhöhen |
| Grund-Rüst > 2× Netto | Setup nicht amortisiert | Bündeln (gleiches Material) |
| Handling > 35 % Brutto | Setup-Verteilung schief | Parallelisieren (Packtisch) |
| Besäumung < 6 mm | Telescopier-Risiko | Nutzen reduzieren / MR anpassen |

## Berechnungsformeln

```
Gesamt-LFM            = Fläche / (SR-Breite / 1000)
Nutzen                = floor(MR-Breite / SR-Breite)
Rest Besäumung        = MR-Breite - (Nutzen × SR-Breite)
Produktion pro Satz   = Nutzen × LFM/SR
Volle Sätze           = floor(Gesamt-LFM / Produktion-Satz)
Restsatz              = Gesamt-LFM - (Volle × Produktion-Satz)
MR-Menge bereitzust.  = ceil(Gesamt-LFM / Nutzen)

Hülsenbedarf          = (Volle + (1 wenn Restsatz)) × Nutzen
Laufzeit netto        = MR-Menge / Geschwindigkeit
Rüstzeit gesamt       = Grund-Rüst + (Sätze × Handling/Satz)
Laufzeit brutto       = Netto + Rüstzeit gesamt
Setup-Anteil          = Rüst-gesamt / Brutto
```

## Test-Auftrag (Beispielwerte)

| Input | Wert |
|---|---|
| Fläche | 2500 qm |
| Mutterrolle | 620 mm |
| Schmalrolle | 29 mm |
| LFM/Schmalrolle | 500 LFM |

| Output | Erwartet |
|---|---|
| Gesamt-LFM | 86.207 |
| Nutzen | 21 |
| Rest | 11 mm (5,5 + 5,5) |
| Sätze gesamt | 9 (8 volle + 1 Restsatz) |
| Restsatz | 2.207 LFM (eingelagert) |
| **MR-Menge bereitstellen** | **4.106 LFM** |
| Hülsen | 189 Stk á 29 mm |

## Tech-Stack

- Vanilla HTML5 / CSS3 / JS — Single File
- SVG für Logo + Schnittspiegel-Viz
- localStorage für Operator-Präferenzen (Speed, Rüstzeiten, Einheiten)
- Auftragsdaten persistieren NICHT — jeder Reload startet leer
- Touch-optimiert (iPad), Glassmorphism, Industrial-Premium-Look

## Deploy

GitHub Pages — kostenfrei, offline-fähig nach erstem Aufruf via "Zum Home-Bildschirm hinzufügen" auf iOS.
