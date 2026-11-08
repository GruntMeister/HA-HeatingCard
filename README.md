# Heating Flow Card

Eine Lovelace-Card für Home Assistant zur Visualisierung von Heizungsanlagen –
optisch angelehnt an power-flow-card-plus: aufgeräumte Boxen an einer zentralen
Verbindungslinie, animierte Flüsse statt überladener Diagramme.

Der Fluss eines Teilnehmers ergibt sich aus der **Temperaturdifferenz** von
Vorlauf und Rücklauf (`flow_temp` – `return_temp`). Ist zusätzlich ein
**Pumpen-Signal** (`pump`) konfiguriert, bestimmt dessen Zustand, ob überhaupt
ein Fluss angezeigt wird, und über `pump_direction` die Richtung (zum Teilnehmer
hin oder von ihm weg).

![Heating Flow Card](screenshot.png)

Unterstützte Teilnehmer-Typen:

| Typ | Bedeutung | Standard-Flussrichtung |
|---|---|---|
| `generator` | Wärmeerzeuger (Wärmepumpe, Kessel, BHKW …) | vom Teilnehmer weg (`from`) |
| `solar` | Solarthermie | vom Teilnehmer weg (`from`) |
| `emitter` | Wärmeabgabe (Heizkreis, Warmwasser …) | zum Teilnehmer hin (`to`) |
| `storage` | Schichtspeicher mit mehreren Temperatur-Schichten | laden = `to`, entladen = `from` (aus Temperaturvergleich) |

## Installation über HACS

1. HACS öffnen → **Frontend** (Custom Repositories) → oben rechts **⋮ → Custom repository**
2. Repository `GruntMeister/HA-HeatingCard` eintragen, Kategorie **Lovelace**
3. Hinzufügen, danach **Heating Flow Card** in HACS installieren und Ressourcen im
   Browser neu laden (Dashboard → oben rechts **⋮ → Ressourcen aktualisieren** bzw. Cache leeren)

Manuelle Installation: `heating-flow-card.js` nach `config/www/community/HA-HeatingCard/`
kopieren und als Ressource vom Typ **JavaScript-Modul** hinzufügen.

## Konfiguration

```yaml
type: custom:heating-flow-card
title: Heizungsanlage
min_temp: 5        # Temperaturspanne für die Farbskala (optional, Default 5)
max_temp: 80       # Default 80
participants:
  - id: waermepumpe
    type: generator
    name: Wärmepumpe
    sensors:
      flow_temp: sensor.wp_vorlauftemperatur
      return_temp: sensor.wp_ruecklauftemperatur
      power: sensor.wp_thermische_leistung   # optional, in kW
    pump: binary_sensor.wp_verdichter       # optional
    pump_direction: from                     # to | from, Default je nach Typ

  - id: solar
    type: solar
    name: Solarthermie
    sensors:
      flow_temp: sensor.solar_vorlauf
      return_temp: sensor.solar_ruecklauf
      power: sensor.solar_leistung
    pump: binary_sensor.solar_pumpe
    pump_direction: from

  - id: puffer
    type: storage
    name: Pufferspeicher
    layers:
      - name: Oben
        temp: sensor.puffer_oben
      - name: Mitte
        temp: sensor.puffer_mitte
      - name: Unten
        temp: sensor.puffer_unten

  - id: heizkreis1
    type: emitter
    name: Heizkreis 1
    sensors:
      flow_temp: sensor.hk1_vorlauf
      return_temp: sensor.hk1_ruecklauf
      power: sensor.hk1_leistung
    pump: binary_sensor.hk1_pumpe
    pump_direction: to
```

### Optionen

| Option | Typ | Beschreibung |
|---|---|---|
| `title` | string | Optionale Überschrift der Card |
| `min_temp` / `max_temp` | number | Temperaturbereich der Farbskala (blau → rot) |
| `participants` | Liste | Teilnehmer der Anlage (Pflicht) |

### Teilnehmer-Optionen

| Option | Beschreibung |
|---|---|
| `id` | Eindeutige ID |
| `type` | `generator`, `solar`, `emitter` oder `storage` |
| `name` | Anzeigename |
| `sensors.flow_temp` | Vorlauftemperatur des Teilnehmers |
| `sensors.return_temp` | Rücklauftemperatur des Teilnehmers |
| `sensors.power` | Thermische Leistung in kW (optional; bestimmt die Flussbreite) |
| `pump` | Binary-Sensor/Schalter der Pumpe (optional). Ist gesetzt, zählt nur das Pumpensignal |
| `pump_direction` | `to` (zum Teilnehmer) oder `from` (vom Teilnehmer weg) |
| `direction` | Feste Flussrichtung ohne Pumpe (Default: `from` bei generator/solar, `to` bei emitter) |
| `threshold` | Minimale Temperaturdifferenz für einen Fluss ohne Pumpe (Default `0.5` K) |
| `layers` | Nur `storage`: Liste von `{ name, temp }` für die Schichtung |

### Flusslogik

- **Mit Pumpe:** Pumpe an → Fluss in Richtung `pump_direction`; Pumpe aus → kein Fluss.
- **Ohne Pumpe:** Fluss, sobald |Vorlauf – Rücklauf| > `threshold`. Richtung über `direction` bzw. Ty-Default.
- **Speicher:** Vergleich der mittleren Schichttemperatur mit der mittleren Vorlauftemperatur
  der Erzeuger/Solar. Bus wärmer → laden (Pfeil in den Speicher), Speicher wärmer → entladen.

Die Breite der animierten Flusslinien skaliert mit Leistung (kW) bzw. Temperaturdifferenz.
