# dji-thermal-ui

Analyze, convert, mosaic and measure DJI thermal datasets in the browser, on your own computer.

dji-thermal-ui is a local web app built on [dji-thermal-cli](https://github.com/WinuxNomacs/dji-thermal-cli). It
does the work with dji-thermal-cli and shows the results in the browser, so neither ODM nor the DJI Thermal SDK is
needed. It is the Thermal Analyzer that used to be a plugin of LuxODM, a WebODM fork, now standing on its own.

- **Projects:** a site's datasets together, with a name, a description and a location, and a map of where each
  dataset was flown. A dataset can be moved to another project. The datasets made before projects existed are in the
  Default Project, which you can rename; one is made again whenever none is left. A project's location is found by
  searching an address or a place on OpenStreetMap, or by clicking the site on the map, and keeps the address.
- **Datasets:** DJI R-JPEGs, uploaded or used in place from a folder, with their thumbnails.
- **Analysis:** the files, cameras and problems dji-thermal-cli finds in a dataset.
- **Conversions:** temperature images with any of dji-thermal-cli's settings. You can keep several side by side,
  cancel one, or download it.
- **Mosaics:** as converted, harmonized, by source frame or by view angle, over a street map or Esri's or Mapbox's
  satellite imagery. The viewer has palettes, a temperature range, brightness and contrast, gamma, equalization
  and sharpening.
- **Measurements:** spots, lines, areas, boxes and circles, ΔT, profiles, histograms and isotherms, on mosaics
  and on single frames. They can be saved, compared, measured again with other settings, and exported as CSV and
  GeoJSON.
- **Source frames:** a spot or an area of a mosaic opens a window with every frame that saw it, the one the mosaic
  used first, each with its time and view angle and the spot marked or the area outlined in it. Draw one with the
  Source frames tool, click the Source frame tab, or open a measurement's; on the compare page, pick a spot. Mosaics
  built before 0.5.0 list only the frames they used: build them again to list every frame.
- **Compare:** two conversions side by side, or their difference, from any dataset, the project's listed first.
- **Navigation:** a pane on the left of every page lists the projects, their datasets and each conversion's
  mosaics, frames and compare page. Each level folds, and the whole pane hides; over a narrow screen it opens on
  top of the page.
- **User Preferences:** temperatures in °F, °C or K, light or dark pages (or the computer's own), both also in the
  header, and the locale dates and times are written in (the computer's, or one chosen). A flight's capture times
  are shown in the time where it was flown, labelled with its time zone (e.g. UTC−5), found from the frames' two
  clocks (a dataset analyzed by an earlier version of the app is analyzed again for it).

It runs on Linux and Windows. The server listens on 127.0.0.1 only, for the one person using the computer: there
are no logins or accounts.

## Install

dji-thermal-ui is not on PyPI yet. From a built wheel, it installs as a command with
`uv tool install dji_thermal_ui-<version>-py3-none-any.whl` (or `pipx install` with the same file). It needs
Python 3.12 or newer.

From a clone, for development: `uv sync` and `npm ci && npm run build` (the pages are built with Node.js), then
`uv run dji-thermal-ui`.

## Run

```
dji-thermal-ui
```

This serves the app on http://127.0.0.1:8765 and opens it in the browser. Press Ctrl+C to stop it. A job still
running when the server stops is marked as interrupted the next time it starts.

| Option | |
|---|---|
| `--data-dir DIR` | the folder for the database and the datasets (see below) |
| `--port PORT` | the port to serve on (default 8765) |
| `--no-browser` | do not open the browser |
| `--version` | print the version |

The maps under the mosaics are loaded from the internet, and a project's location is searched for on OpenStreetMap's
[Nominatim](https://nominatim.org/) (the text searched, or the point clicked, is sent to it by the app, at most once a
second; the addresses are © OpenStreetMap contributors, under the ODbL). Everything else works offline.

## The maps under the mosaics

The switch at the top right of a mosaic's map chooses what is under it:

- **ESRI Satellite** (the default) and **OpenStreetMap** need nothing set up. Where Esri's imagery stops short of the
  zoom shown, its deepest level there is stretched instead of showing "Map data not yet available".
- **Mapbox Satellite** needs a Mapbox account of your own and its access token. Choose "Mapbox Satellite: add a
  token…" in the switch: the form says how to get one and saves it. The same form changes or removes it.

To get the token:

1. Sign up at [mapbox.com](https://account.mapbox.com/auth/signup/): no card is needed. The imagery comes through
   Mapbox's Static Tiles API, whose free allowance is 200,000 tiles a month; Mapbox charges past it only when a card
   is on the account.
2. On the [Access tokens](https://console.mapbox.com/account/access-tokens/) page, copy the **Default public token**
   (it starts with `pk.`), or create a token with the public scopes only. A secret token (`sk.`) is refused: the
   browser sends the token to Mapbox with each tile, so anyone using the page could read it. Mapbox's URL
   restrictions do not accept `127.0.0.1`, so leave the token unrestricted.
3. Paste it into the form. Mapbox's [Statistics](https://console.mapbox.com/account/statistics/) page shows how many
   tiles have been used.

Whoever sets the app up can give the token in `MAPBOX_API_TOKEN` instead, in the environment or in a `.env` file
(`MAPBOX_API_TOKEN=pk....`) in the folder the app is started from or in the data folder. A token saved in the form
is used instead of it, and removing that one goes back to it.

## Where the data lives

The database (SQLite), the secret key and each dataset's files (`datasets/<id>/`) are kept in one data folder:

- Linux: `~/.local/share/dji-thermal-ui`
- Windows: `%LOCALAPPDATA%\dji-thermal-ui`

`--data-dir` or the `DJI_THERMAL_UI_DATA_DIR` environment variable uses another folder. A dataset used in place
from a folder reads its images there and never changes them. Deleting a dataset deletes only what the app made.
Deleting a project deletes its datasets the same way, after saying how many there are and how much space is freed.

## Development

```
uv sync
uv run pytest            # DJI_THERMAL_FLIGHT_DIR=<a folder of one flight's R-JPEGs> runs the flight tests too
uv run ruff check
npm ci
npm test                 # the pages' tests (Vitest)
npm run -s lint          # ESLint and the TypeScript check
npm run build            # the pages, into src/dji_thermal_ui/static/dist (`-- --watch` while working on them)
```

Release checks, on the built distributions (after `npm run build`, which they carry):

```
uv build --no-sources
uv run --no-project python scripts/check_dist.py dist
uvx twine@7.0.0 check --strict dist/*
uv run --no-project python scripts/smoke.py uvx --from dist/dji_thermal_ui-<version>-py3-none-any.whl dji-thermal-ui
```

CI (`.github/workflows/ci.yml`) runs these and the tests on Linux and Windows on every push. It publishes nothing.

## Licence

AGPL-3.0-only (see [LICENSE](LICENSE)). Parts of the code come from WebODM and LuxODM (AGPL-3.0), whose files keep
their notices. The pages bundle Preact (MIT) and OpenLayers (BSD-2-Clause, with rbush, MIT, and quickselect,
ISC); their licences are in `THIRD-PARTY-LICENSES.txt` beside the built pages, in `dji_thermal_ui/static/dist/`.
Mapbox's wordmark, shown with its imagery, comes from Mapbox GL JS 1.13.3 (BSD-3-Clause), with its licence in
`dji_thermal_ui/static/vendor/mapbox/`.
