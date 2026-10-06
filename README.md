# HRDF Explorer

A web app for browsing the Swiss public-transport timetable in **HRDF 5.40** format, as published on [opentransportdata.swiss](https://opentransportdata.swiss/en/dataset/timetable-54-2027-hrdf). Use it to answer questions like:

- Which DIDOK / BPUIC number does this station have? What are its coordinates, SLOID, quays and tracks?
- What leaves station X on date D after 07:30? For each departure: line, category, Zugnummer, operator, destination and track.
- What is this journey's stop sequence and times? On which days does it run, and does it run on a given date?
- Which journeys use bitfield 3933?
- What does the original fixed-width HRDF line look like?

Every file in the zip has a browsable, searchable view with decoded fields and links between records. Files without a dedicated decoder get a generic tokenised view.

## Quick start

Requires **Node 22 LTS** and about 4 GB of free disk space. Next 16 wants Node ≥20.9; `better-sqlite3@13` wants ≥22. Node 18 (`npm install` on an older Mac) fails with `EBADENGINE` and a native rebuild error (no `distutils`).

Install Node 22, then wipe `node_modules` before installing:

```bash
# pick one
nvm install 22 && nvm use 22
fnm install 22 && fnm use 22
brew install node@22
```

```bash
rm -rf node_modules
npm install
npm run dev             # http://localhost:4317
```

On first load, if `data/hrdf.sqlite` is missing or empty, the app shows a wizard:

- **Fetch the newest build** — downloads the latest 2027 HRDF zip from opentransportdata.swiss (~200 MB) and imports it.
- **Use a local zip** — drop or choose a zip; the same importer as `npm run data:build -- path/to.zip` runs in the background.

A full import writes ~3.3 GB and takes about 3 minutes. The wizard has a real progress bar, plus loading, error and success states. You can also replace the current database from the home page drop zone. CLI still works:

```bash
npm run data:fetch      # downloads the latest 2027 HRDF zip (~200 MB) to data/hrdf.zip
npm run data:build      # streams it into data/hrdf.sqlite (~3.3 GB, about 3 min)
```

`package.json` has `"engines": { "node": ">=22" }`. `.nvmrc` / `.node-version` are set to `22`.

`data/` is git-ignored. Raw HRDF data and the database are never committed.

The SQLite file is ~3.3 GB, so serverless hosts (Vercel Hobby and similar) cannot run this app. There is no free public URL; use the local commands above.

To load another HRDF dataset, pass a dataset slug or a direct zip URL:

```bash
npm run data:fetch -- timetable-54-2026-hrdf
npm run data:fetch -- https://…/oev_sammlung_ch_hrdf_5_40_41_2027_….zip
npm run data:build -- path/to/hrdf.zip data/hrdf.sqlite
```

Environment overrides: `HRDF_ZIP` (zip path), `HRDF_DB` (database path; the app reads this too), `HRDF_URL`.

The permalink always resolves to the newest build. New builds come out twice a week. The home page shows the build timestamp from ECKDATEN.

## What's in the app

| Area | Route | Source files |
|---|---|---|
| Overview | `/` | ECKDATEN plus counts |
| Station search | `/stations?q=` | BAHNHOF (names, synonyms, abbreviations), numbers, SLOIDs |
| Station detail and departure/arrival board | `/stations/8503000?date=2026-12-14&time=07:30&mode=dep` | BAHNHOF, BFKOORD_*, BHFART, BFPRIOS, KMINFO, METABHF, GLEISE, FPLAN |
| Journey search | `/journeys?nr=&admin=&category=&line=&stop=&bitfield=&date=` | FPLAN `*Z/*G/*L/*A VE` |
| Journey detail | `/journeys/:id?date=…&tab=stops\|days\|records\|raw\|related` | Stop timeline with tracks, operating-day calendar, "does it run on date X", decoded star lines, raw lines, same Zugnummer, DURCHBI, UMSTEIGZ |
| Bitfields | `/bitfields`, `/bitfields/:id` | BITFELD/BITFIELD against ECKDATEN: calendar, weekday profile, raw bits, journeys using it |
| FPLAN line browser | `/files/FPLAN?type=*A&code=VE` | Every `*Z/*G/*A/*I/*L/*R/*CI/*CO` line across all journeys, plus stop lines |
| Any file | `/files/:name` | All 32 files, searchable, with decoded columns and the raw line |
| Reference pages | `/ref/{admin,category,line,attribute,direction,infotext}/:id` | BETRIEB_*, ZUGART, LINIE, ATTRIBUT, RICHTUNG, INFOTEXT_* |

The header search accepts names, 7-digit stop numbers, `IC 2577`-style category + number, or plain Zugnummern. The DE/FR/IT/EN switch in the header selects the language of info texts, operators, attributes and category names. Dark mode follows the system setting and can be toggled.

## How it works

- `scripts/build-db.ts` streams the zip with `yauzl` and `readline`, so nothing is loaded into memory whole. It writes:
  - `journeys`: one row per `*Z`, with category, line, direction, bitfield, SJYID, and the original block zlib-compressed for the raw view.
  - `stops`: 13.3M route lines, with times as minutes plus negative-time flags.
  - `jlines`: every star line, parsed into type, code, from/to stop, bitfield and reference.
  - `gleis` / `gleis_def`: GLEISE.
  - `lines`: every line of every other file, with section and key.
  - `refs`: cross-references (stop, bitfield, administration, …) extracted by the decoders, which power the "mentioned in files" lookups.
- `src/lib/hrdf/fplan.ts` and `src/lib/hrdf/decoders.ts` hold the fixed-width column definitions (HRDF 5.40.41 and the Swiss Realisierungsvorgaben). The importer and the UI share them.
- Pages are React Server Components that query SQLite read-only through `better-sqlite3`.

Stack: Next.js 16 (App Router), TypeScript, Tailwind CSS v4, shadcn/ui, better-sqlite3.

## Data and parsing notes

- **Bitfields**: each hex digit is 4 days, MSB first. The first **2 bits are padding**, so bit `i+2` is day `i` counted from the ECKDATEN start (13.12.2026). A blank or `000000` VE bitfield means daily.
- **Times** are `HHHMM` relative to the operating day. Values ≥ 24:00 are shown with `+1`. The board for date D also includes journeys from day D−1 whose times pass midnight. Negative times follow RV §4.3: pick-up only, drop-off only, transit, or service stop. They are struck through and excluded from boards.
- **Cycles** (`*Z` cycle count and minutes) are expanded on departure boards. The journey page lets you step through the repetitions.
- **Per-section `*A VE`** (about 30 journeys): boards use the VE that covers the stop. A **departure** at a section-boundary stop uses the section that *starts* there; an **arrival** uses the one that *ends* there. The journey page says “runs on part of the route” when only some sections run. The calendar shows one grid per section.
- **Tracks**: GLEISE assignments prefer an exact-time row over an untimed one, and arrival/departure tracks are looked up separately. `G ''` entries are labelled “no track name (quay …)” with the full SLOID on hover. GLEISE_WGS and GLEISE_LV95 have identical assignment lines (checked by hash during import), so they are stored once. Only the coordinate lines differ.
- **ZEITVS** ships as one physical line with comments running into the next record. The importer re-splits it into its 39 records, including the type-2 "copy rules from" records.
- `(journey number, administration)` is not unique. The app uses its own journey ID and lists all variants.
- Range resolution inside a journey (`*A`/`*G`/`*L`/`*I`/`*R`/`*CI`/`*CO` from/to) follows H §7.1.1: empty = first/last stop, `#n` = 0-based route index, from-stop searched from the front, to-stop from the back, with the time and `#n` occurrence columns used to disambiguate loops.
- **Attributes** (`*A`, other than VE) are shown on the journey timeline for the selected date, using ATTRIBUT stop relevance (boarding / alighting / intermediate / section) and `#` output rules (`--` suppresses a partial section).
- ZEITVS is shown but not applied: times are displayed as published (local time of each stop).

