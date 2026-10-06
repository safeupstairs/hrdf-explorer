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
npm run data:fetch      # downloads the latest 2027 HRDF zip (~200 MB) to data/hrdf.zip
npm run data:build      # streams it into data/hrdf.sqlite (~3.3 GB, about 3 min)
npm run dev             # http://localhost:4317
```

`package.json` has `"engines": { "node": ">=22" }`. `.nvmrc` / `.node-version` are set to `22`.

`data/` is git-ignored. Raw HRDF data and the database are never committed.

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

## Deploy (full 2027 database)

The SQLite file is **~3.3 GB** after `data:fetch` + `data:build`. Serverless hosts (Vercel Hobby, Netlify, Cloudflare Workers) cannot hold it. A running Node process with **~4 GB disk** and **≥1 GB RAM** is required. `better-sqlite3` stays as the library.

No $0 PaaS disk currently fits that file:

| Platform | Disk that can hold 3.3 GB | Cost |
|---|---|---|
| Vercel Hobby | none (serverless) | n/a |
| Koyeb Free | 2 GB SSD | too small |
| Render Free | ephemeral, **no persistent disk** | rebuild lost on every spin-down; 512 MB RAM |
| Hugging Face Docker CPU Basic | 50 GB ephemeral, 16 GB RAM | **creating** a Docker Space now needs a paid HF plan (PRO). Runtime on CPU Basic is $0/hour after that. |
| Fly.io volume | 10 GB persistent | **$0.15/GB-month = $1.50/month** for 10 GB, plus a 1 GB shared VM (~$8.78/month if always on; less with auto-stop) |

**Cheapest persistent option: Fly.io 10 GB volume ($1.50/month storage)** plus a `shared-cpu-1x` 1 GB machine. That is the path this repo is wired for (`Dockerfile` + `fly.toml`).

This VM cannot deploy for you: there is no Fly/Render/Railway/HF token here, only GitHub. One-time clicks on your machine:

1. Install [flyctl](https://fly.io/docs/flyctl/install/) and sign in (`fly auth login`). New Fly accounts are pay-as-you-go (credit card).
2. From the repo root:

```bash
fly launch --no-deploy --copy-config --name hrdf-explorer --region fra
fly secrets set GH_TOKEN="$GH_TOKEN"
fly deploy
```

`fly launch` creates the app and a 10 GB volume mounted at `/data`. First boot runs `data:fetch` + `data:build` into `/data/hrdf.sqlite` (~3 minutes). Later boots reuse the volume. Auto-stop is on, so idle machines go to sleep; the next request may take a few seconds (or ~3 minutes if you skipped the volume and the DB has to be rebuilt).

Public URL after deploy: `https://hrdf-explorer.fly.dev` (or the name `fly launch` assigned).

Set `GH_TOKEN` as a Fly secret so GitHub API calls work at runtime. Do not commit it.

To redeploy from GitHub later, add an Actions secret `FLY_API_TOKEN` (`fly tokens create deploy -a hrdf-explorer`) and a workflow that runs `flyctl deploy --remote-only --wait-timeout 15m` on `workflow_dispatch`. This token cannot push `.github/workflows/` files (needs the `workflow` scope), so add that workflow from the GitHub UI if you want it.

### Docker locally (same image the host runs)

```bash
docker build -t hrdf-explorer .
docker run --rm -p 4317:8080 -v hrdf-data:/data -e PORT=8080 hrdf-explorer
```

First run downloads and builds the 2027 database into the `hrdf-data` volume. Open http://localhost:4317.

### Hugging Face Spaces (if you already have PRO)

Create a **Docker** Space from this GitHub repo, set **app port 8080**, add `GH_TOKEN` under Space secrets, and leave hardware on **CPU Basic** (16 GB RAM, 50 GB disk, $0/hour). The same Dockerfile fetches the full timetable on first start. The DB is ephemeral unless you attach paid storage; a sleep/restart rebuilds it.

### Render / Railway

GitHub-connected, but not free at this size. Render persistent disks start at **$0.25/GB-month** and need a **paid** web service (Starter $7/month, 512 MB RAM — tight; Standard 2 GB RAM is safer). Railway volumes are similar (~$0.15/GB-month) on the Hobby plan.

