<p align="center">
  <img src="holcim_logo.png" width="220" alt="Holcim Lafarge logo"/>
</p>

# Holcim Lafarge — Transport Cost Calculator

A production-style internal web tool for estimating cement transport cost in Algeria. The app combines interactive routing, truck-aware distance calculation, contract pricing from Google Sheets, and optional historical invoice analysis from Excel — all behind a small Node.js backend that keeps API keys off the client.

---

## The Problem

Transport teams need a fast way to answer a simple question: **“How much should it cost to move product from plant X to destination Y?”**

In practice, the answer depends on several things at once:

- the **entity / loading plant**: `CILAS`, `LCM`, or `LCO`
- the **packaging / loading condition**: `Sac`, `Vrac`, or `Clinker`
- the **truck type**: `Plateau`, `Benne`, or `Cocotte`
- the **real road distance**, not just a straight line on a map
- the **current pricing logic** stored in Google Sheets
- optionally, the **actual historical invoices** for similar past trips

This project wraps all of that into one browser page: select the route, calculate the distance, compare routing providers, estimate the price, and — if an Excel history file is provided — check whether past invoices agree with the estimate.

---

## What The App Does

| Capability | How it works |
|---|---|
| Interactive map | Leaflet + OpenStreetMap tiles |
| Address autocomplete | Geoapify autocomplete through `/api/autocomplete` |
| Map click selection | Reverse geocoding through `/api/reverse` |
| Standard road route | Geoapify Routing through `/api/route/geo` |
| Truck route | TomTom truck routing through `/api/route/tom` |
| Theoretical transport price | Google Apps Script pricing endpoint through `/api/cost` |
| Historical invoice benchmark | Excel upload parsed by `/api/stats` |
| Secret protection | API keys stay in `.env` on the server, never in `index.html` |

The frontend is intentionally simple: one page, one sidebar, one map. The backend is the integration layer that talks to Geoapify, TomTom, Google Sheets, and the uploaded Excel file.

---

## User Flow

```
User opens app
      │
      ▼
Select Entity ───────────────► Start point auto-fills from fixed plant GPS
      │
Select Conditionnement ──────► Truck type auto-syncs
      │                         Sac → Plateau
      │                         Vrac → Cocotte
      │                         Clinker → Benne
      ▼
Pick destination
  · type address + choose suggestion, or
  · click directly on the map
      │
      ▼
Click “Calculer le coût de transport”
      │
      ├──────────────► Geoapify route ──► blue line + distance + price
      ├──────────────► TomTom truck route ──► red dashed line + distance + price
      └──────────────► Optional Excel history ──► real invoice stats
      │
      ▼
Results cards show:
  · distance in km
  · theoretical DZD / tonne
  · historical min / median / average / max if found
```

---

## Why A Backend If The Frontend Is Only One Page?

The browser could call Geoapify or TomTom directly, but that would expose private API keys inside `index.html`. This project avoids that by making the frontend call only same-origin endpoints under `/api/*`.

The backend then:

1. reads keys from `.env`
2. calls the external provider
3. returns only the JSON the UI needs

That means `index.html` contains **no secrets**, and the repo can be shared without leaking provider credentials.

---

## Architecture

```
index.html
  │  same-origin fetch calls only
  ▼
server.js  ── Express app
  │
  ├─ GET  /api/autocomplete ─► Geoapify Geocode Autocomplete
  ├─ GET  /api/reverse      ─► Geoapify Reverse Geocode
  ├─ GET  /api/route/geo    ─► Geoapify Routing
  ├─ GET  /api/route/tom    ─► TomTom Truck Routing
  ├─ POST /api/cost         ─► Google Apps Script pricing
  └─ POST /api/stats        ─► Excel historical invoice analysis
```

### Frontend responsibilities

`index.html` owns the user experience:

- renders the header, form, map, and result cards
- keeps start/end coordinates in `dataset.lat` / `dataset.lng`
- stores destination city/wilaya from the selected Geoapify suggestion
- draws the Geoapify route in **blue**
- draws the TomTom truck route in **red dashed**
- optionally uploads an Excel file for historical comparison

### Backend responsibilities

`server.js` owns the integrations and calculations:

- serves static files and `index.html`
- proxies Geoapify autocomplete / reverse / routing
- proxies TomTom truck routing
- forwards pricing parameters to Google Apps Script
- parses uploaded Excel files in memory with `multer` + `xlsx`
- normalizes messy text before matching historical rows
- computes `count`, `min`, `max`, `avg`, `median`, and most frequent rounded km

---

## Pricing Logic

The app separates **distance** from **price**.

### 1. Distance

Two road distances are calculated in parallel:

- **Geoapify**: standard driving route
- **TomTom**: truck-aware route with `travelMode=truck`, `vehicleCommercial=true`, and `traffic=true`

This gives the user a practical comparison: a normal road estimate versus a truck-oriented estimate.

### 2. Theoretical price

For each successful route, the frontend sends the calculated km to:

```http
POST /api/cost
Content-Type: application/json

{
  "entity": "CILAS",
  "truck": "Plateau",
  "condi": "Sac",
  "km": 412.8
}
```

The backend converts decimal km to the French/Algerian comma format before calling Google Apps Script:

```txt
412.8 → 412,8
```

The Apps Script URL is expected to return JSON containing a `cost` value, which the UI displays as **DZD / tonne**.

---

## Historical Excel Analysis

The optional Excel upload is not just storage — it is a small matching engine.

### Expected columns

The historical file should contain columns close to:

| Column | Used for |
|---|---|
| `site_chargement` | loading site / plant |
| `conditionnement` | packaging / loading condition |
| `wilaya` | destination wilaya |
| `ville` | destination city |
| `cout_par_unite` | historical unit cost |
| `km` or `distance` | historical trip distance |

### Matching strategy

The backend normalizes text before comparing it:

- lowercase
- accents removed
- non-alphanumeric characters removed

So values like `M'Sila`, `Msila`, and `m sîla` become much easier to match.

Then it filters in stages:

1. **Base filter** — exact normalized match on:
   - `site_chargement`
   - `conditionnement`

2. **Wilaya fuzzy match** — compares the destination wilaya against historical wilayas using `string-similarity`
   - accepted when similarity is at least `0.55`

3. **City fuzzy match** — compares the destination city against cities inside the matched wilaya
   - accepted when similarity is at least `0.50`
   - if the city is not confident enough, it falls back to wilaya-level rows

### Returned statistics

If matching invoices are found, `/api/stats` returns:

```json
{
  "found": true,
  "precision": "Ville exacte : alger",
  "count": 18,
  "max": 2950,
  "min": 2100,
  "avg": 2443.7,
  "frequentKm": 410,
  "median": 2400
}
```

The UI then shows a green “Historique Réel” card with:

- number of past invoices
- most frequent distance
- median price
- average price
- minimum price
- maximum price

If nothing matches, the UI shows a warning card instead of silently failing.

---

## Built-In Business Rules

These rules are currently hard-coded in the frontend and backend.

### Entity → plant

| Entity | Plant used for historical matching |
|---|---|
| `CILAS` | Usine Biskra |
| `LCM` | Usine M'sila |
| `LCO` | Usine Oggaz |

### Entity → default start point

The frontend keeps fixed GPS coordinates for each plant in `ENTITY_LOCATIONS`. When the entity changes, the start field is replaced with that plant location and the map zooms to it.

Current values in the repo:

| Entity | Label | Lat | Lng |
|---|---|---:|---:|
| `CILAS` | Cimenterie Cilas Manbaa El Ghozlane, Djemourah, Biskra, Algeria | 35.0974 | 5.6476 |
| `LCM` | Lafarge Ciment, Hammam Dhalaa, Algeria | 35.8793 | 4.4468 |
| `LCO` | Cimenterie du Sig (CIBA), RN 4, 29029 Oggaz, Algeria | 35.5319 | -0.2767 |

> If plant coordinates change, update `ENTITY_LOCATIONS` in `index.html`.

### Conditionnement → truck type

| Conditionnement | Auto-selected truck |
|---|---|
| `Sac` | `Plateau` |
| `Vrac` | `Cocotte` |
| `Clinker` | `Benne` |

The user can still change the truck afterward if needed.

---

## Project Structure

```txt
Lafarge/
├── index.html          # Complete frontend: layout, map, autocomplete, result cards
├── server.js           # Express backend: API proxies + Excel stats engine
├── package.json        # Node scripts and dependencies
├── package-lock.json   # Locked dependency tree
├── holcim_logo.png     # Logo used by the app and this README
├── .gitignore
└── README.md
```

---

## Setup

### Requirements

- Node.js 18+ recommended
- npm
- API keys for:
  - Geoapify
  - TomTom
  - Google Apps Script pricing endpoint

### 1. Install

```bash
git clone https://github.com/Ryad-11/Lafarge.git
cd Lafarge
npm install
```

### 2. Configure environment

Create a `.env` file in the project root:

```env
GEO_KEY=your_geoapify_key
TOMTOM_KEY=your_tomtom_key
APPS_SCRIPT_URL=https://script.google.com/macros/s/.../exec
PORT=3000
```

`PORT` is optional; it defaults to `3000`.

### 3. Run

```bash
npm start
```

Open:

```txt
http://localhost:3000
```

---

## API Reference

### `GET /api/autocomplete`

Proxy for Geoapify address autocomplete.

**Query params**

| Param | Description |
|---|---|
| `text` | partial address typed by the user |

The request is restricted to these country codes:

```txt
dz, ma, tn, ly, ne, ml, mr
```

---

### `GET /api/reverse`

Proxy for Geoapify reverse geocoding.

**Query params**

| Param | Description |
|---|---|
| `lat` | latitude clicked on the map |
| `lon` | longitude clicked on the map |

---

### `GET /api/route/geo`

Proxy for Geoapify driving route.

**Query params**

| Param | Description |
|---|---|
| `waypoints` | `lat1,lng1|lat2,lng2` |

---

### `GET /api/route/tom`

Proxy for TomTom truck routing.

**Query params**

| Param | Description |
|---|---|
| `lat1` | start latitude |
| `lng1` | start longitude |
| `lat2` | destination latitude |
| `lng2` | destination longitude |

TomTom is called with truck-oriented options:

```txt
travelMode=truck
vehicleCommercial=true
traffic=true
```

---

### `POST /api/cost`

Calls the Google Apps Script pricing endpoint.

**Body**

```json
{
  "entity": "CILAS",
  "truck": "Plateau",
  "condi": "Sac",
  "km": 250.4
}
```

The backend forwards:

- `entity`
- `truck`
- `condi`
- `km` formatted with a comma decimal separator

Expected response: JSON with a `cost` field.

---

### `POST /api/stats`

Uploads an Excel file and searches for similar historical invoices.

**Form-data fields**

| Field | Description |
|---|---|
| `excelFile` | `.xlsx`, `.xls`, or `.csv` file |
| `entity` | `CILAS`, `LCM`, or `LCO` |
| `condi` | `Sac`, `Vrac`, or `Clinker` |
| `geoCity` | destination city extracted from Geoapify |
| `geoWilaya` | destination wilaya/state extracted from Geoapify |

Returns either `{ "found": false }` or a statistics object with `count`, `min`, `max`, `avg`, `median`, and `frequentKm`.

---

## Important Notes

- The old README referenced `Outil.html`, but the current repo entry point is **`index.html`**.
- `index.html` contains no provider keys by design; do not add keys there.
- Keep `.env` out of git.
- The Excel history feature depends on column names being close to the expected ones listed above.
- The app is optimized for Algeria and neighboring countries because autocomplete is limited to `dz,ma,tn,ly,ne,ml,mr`.

---

## Built With

- [Express](https://expressjs.com/) — Node.js backend
- [Leaflet](https://leafletjs.com/) — interactive map
- [OpenStreetMap](https://www.openstreetmap.org/) — map tiles
- [Geoapify](https://www.geoapify.com/) — autocomplete, reverse geocoding, routing
- [TomTom Routing API](https://developer.tomtom.com/routing-api/documentation/routing/calculate-route) — truck-aware routing
- [Google Apps Script](https://developers.google.com/apps-script) — external pricing endpoint
- [multer](https://github.com/expressjs/multer) — in-memory Excel upload handling
- [xlsx](https://www.npmjs.com/package/xlsx) — Excel parsing
- [string-similarity](https://www.npmjs.com/package/string-similarity) — fuzzy wilaya/city matching
- [dotenv](https://www.npmjs.com/package/dotenv) — environment variable loading
- [cors](https://www.npmjs.com/package/cors) — CORS middleware
