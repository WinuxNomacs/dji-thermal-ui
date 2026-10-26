# dji-thermal-ui

Analyze, convert, mosaic and measure DJI thermal datasets in the browser, on your own computer.

dji-thermal-ui is a local web app built on [dji-thermal-cli](https://github.com/WinuxNomacs/dji-thermal-cli). It
does the work with dji-thermal-cli and shows the results in the browser, so neither ODM nor the DJI Thermal SDK is
needed. It is the Thermal Analyzer that used to be a plugin of LuxODM, a WebODM fork, now standing on its own.

- **Datasets:** DJI R-JPEGs, uploaded or used in place from a folder, with their thumbnails.
- **Analysis:** the files, cameras and problems dji-thermal-cli finds in a dataset.
- **Conversions:** temperature images with any of dji-thermal-cli's settings. You can keep several side by side,
  cancel one, or download it.
- **Mosaics:** as converted, harmonized, by source frame or by view angle, over a street or satellite map. The
  viewer has palettes, a temperature range, brightness and contrast, gamma, equalization and sharpening.
- **Measurements:** spots, lines, areas, boxes and circles, ΔT, profiles, histograms and isotherms, on mosaics
  and on single frames. They can be saved, compared, measured again with other settings, and exported as CSV and
  GeoJSON.
- **Compare:** two conversions side by side, or their difference.
- Temperatures in °F, °C or K.

It runs on Linux and Windows. The server listens on 127.0.0.1 only, for the one person using the computer: there
are no logins or accounts.

## Install

dji-thermal-ui is not on PyPI yet. From a built wheel, it installs as a command with
`uv tool install dji_thermal_ui-<version>-py3-none-any.whl` (or `pipx install` with the same file). It needs
Python 3.12 or newer.

From a clone, for development: `uv sync`, then `uv run dji-thermal-ui`.

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

The street and satellite maps under the mosaics are loaded from OpenStreetMap and Esri, so they need an internet
connection. Everything else works offline.

## Where the data lives

The database (SQLite), the secret key and each dataset's files (`datasets/<id>/`) are kept in one data folder:

- Linux: `~/.local/share/dji-thermal-ui`
- Windows: `%LOCALAPPDATA%\dji-thermal-ui`

`--data-dir` or the `DJI_THERMAL_UI_DATA_DIR` environment variable uses another folder. A dataset used in place
from a folder reads its images there and never changes them. Deleting a dataset deletes only what the app made.

## Development

```
uv sync
uv run pytest            # DJI_THERMAL_FLIGHT_DIR=<a folder of one flight's R-JPEGs> runs the flight tests too
uv run ruff check
npm ci
npx jest
npm run -s lint
```

Release checks, on the built distributions:

```
uv build --no-sources
uv run --no-project python scripts/check_dist.py dist
uvx twine@7.0.0 check --strict dist/*
uv run --no-project python scripts/smoke.py uvx --from dist/dji_thermal_ui-<version>-py3-none-any.whl dji-thermal-ui
```

CI (`.github/workflows/ci.yml`) runs these and the tests on Linux and Windows on every push. It publishes nothing.

## Licence

AGPL-3.0-only (see [LICENSE](LICENSE)). Parts of the code come from WebODM and LuxODM (AGPL-3.0), whose files keep
their notices. The vendored Bootstrap 3.4.1 (MIT), Font Awesome Free 5.15.4 (Font Awesome Free License) and
Leaflet 1.3.1 (BSD-2-Clause) are in `src/dji_thermal_ui/static/vendor/`, with their licences.
