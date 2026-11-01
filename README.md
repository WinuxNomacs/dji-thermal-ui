# dji-thermal-ui

Analyze, convert, mosaic and measure DJI thermal flights in the browser, on your own computer.

dji-thermal-ui is a local web app built on [dji-thermal-cli](https://github.com/WinuxNomacs/dji-thermal-cli). It
does the work with dji-thermal-cli and shows the results in the browser, so neither ODM nor the DJI Thermal SDK is
needed. It is the Thermal Analyzer that used to be a plugin of LuxODM, a WebODM fork, now standing on its own.

- **[Projects]** hold a site's flights, with its location and findings, and export to a `.tar` that imports again
  here or on another computer.
- **[Flights]** take DJI R-JPEGs, their visual images and the drone's videos; dji-thermal-cli's analysis lists their
  files and the problems it finds, with the settings that fix them.
- **[Datasets]** are the images converted to temperatures, with their thermal and visual [mosaics], each frame in the
  [frames explorer].
- **[Measuring]** spots, lines, areas, boxes and circles on mosaics and frames, with every frame that saw a spot, and
  **[findings]** kept on the flight.
- **[Reports]** of a flight and of a mosaic, to print or save as PDF; **[compare]** two mosaics or their difference;
  **[exports]** as TIFF, PNG, R-JPEG or GeoTIFF, private if you like.
- **[WebODM]**: a dataset's temperatures processed in a WebODM of your own, its orthophoto and surface model brought
  back.

It runs on Linux, macOS and Windows. The server listens on 127.0.0.1 only, for the one person using the computer:
there are no logins or accounts.

**[The documentation]** is on its own site, and in the app itself: the header's **Help** opens it at the page for the
page you are on, from the copy installed, so it matches that version and works offline.

## Install

dji-thermal-ui is not on PyPI yet. From a built wheel, it installs as a command with
`uv tool install dji_thermal_ui-<version>-py3-none-any.whl` (or `pipx install` with the same file). It needs
Python 3.12 or newer.

From a clone, for development: `uv sync`, `npm ci && npm run build` (the pages are built with Node.js) and
`uv run --only-group docs zensical build --strict` (the help), then `uv run dji-thermal-ui`.

### From a clone, with the script

On Linux, WSL or macOS, `dji-thermal-ui.sh` at the top of the clone does those steps and runs the app in the
background:

| Command | |
|---|---|
| `./dji-thermal-ui.sh build` | set up the environment, or bring it up to date: `uv sync --locked`, `npm ci`, `npm run build` and the help's build (Zensical). It does not pull: the code checked out is used as it is. Without uv, it installs uv into `~/.local/bin` first (without changing the shell's startup files); without Node.js and npm, it stops and says where to get them. |
| `./dji-thermal-ui.sh rebuild` | the same as `build` |
| `./dji-thermal-ui.sh start` | start the app in the background, on http://127.0.0.1:8080, building it first if it was never built. Options after `start` go to the command: `--port`, `--data-dir`, `--no-browser`. |
| `./dji-thermal-ui.sh stop` | stop it (as Ctrl+C would) |
| `./dji-thermal-ui.sh restart` | stop, then start, with the options given |
| `./dji-thermal-ui.sh status` | whether it runs, and at which address (exit status 3 when it does not) |
| `./dji-thermal-ui.sh logs` | the end of its log; `logs -f` follows it |

Its PID file and log are in `.run/` in the clone (`DJI_THERMAL_UI_RUN_DIR` puts them elsewhere).

## Run

```
dji-thermal-ui
```

This serves the app on http://127.0.0.1:8080 and opens it in the browser. Press Ctrl+C to stop it. A job still
running when the server stops is marked as interrupted the next time it starts.

| Option | |
|---|---|
| `--data-dir DIR` | the folder for the database and the flights |
| `--port PORT` | the port to serve on (default 8080) |
| `--no-browser` | do not open the browser |
| `--version` | print the version |

The maps under the mosaics are loaded from the internet, and a project's location is searched for on OpenStreetMap's
Nominatim; everything else works offline (see [First run]).
The data folder is `~/.local/share/dji-thermal-ui` on Linux, `~/Library/Application Support/dji-thermal-ui` on macOS
and `%LOCALAPPDATA%\dji-thermal-ui` on Windows (see [Where the data lives]).

## Development

```
uv sync
uv run pytest            # DJI_THERMAL_FLIGHT_DIR=<a folder of one flight's R-JPEGs> runs the flight tests too
                         # (with its _V images beside them, the visual mosaic's too)
uv run ruff check
npm ci
npm test                 # the pages' tests (Vitest)
npm run -s lint          # ESLint and the TypeScript check
npm run build            # the pages, into src/dji_thermal_ui/static/dist (`-- --watch` while working on them)
uv run --only-group docs zensical build --strict    # the documentation (docs/), into src/dji_thermal_ui/static/docs
```

The documentation's sources are `docs/`, laid out in `zensical.toml`; `zensical serve` instead of `build` shows them
as they are written. `scripts/publish_docs.py <clone>` builds them and commits them in a clone of the public
`dji-thermal-ui-docs` repository, which GitHub Pages serves; it never pushes.

Release checks, on the built distributions (after `npm run build` and the documentation's build, which they carry):

```
uv build --no-sources
uv run --no-project python scripts/check_dist.py dist
uvx twine@7.0.0 check --strict dist/*
uv run --no-project python scripts/smoke.py uvx --from dist/dji_thermal_ui-<version>-py3-none-any.whl dji-thermal-ui
```

CI (`.github/workflows/ci.yml`) runs these and the tests on Linux and Windows when a `v*` tag is pushed, or when it is run by hand from the Actions tab. It publishes nothing.

## Licence

AGPL-3.0-only (see [LICENSE](LICENSE)). Parts of the code come from WebODM and LuxODM (AGPL-3.0), whose files keep
their notices. The pages bundle Preact (MIT) and OpenLayers (BSD-2-Clause, with rbush, MIT, and quickselect,
ISC); their licences are in `THIRD-PARTY-LICENSES.txt` beside the built pages, in `dji_thermal_ui/static/dist/`.
Mapbox's wordmark, shown with its imagery, comes from Mapbox GL JS 1.13.3 (BSD-3-Clause), with its licence in
`dji_thermal_ui/static/vendor/mapbox/`.

[The documentation]: https://winuxnomacs.github.io/dji-thermal-ui-docs/
[Projects]: https://winuxnomacs.github.io/dji-thermal-ui-docs/guide/projects/
[Flights]: https://winuxnomacs.github.io/dji-thermal-ui-docs/guide/flights/
[Datasets]: https://winuxnomacs.github.io/dji-thermal-ui-docs/guide/datasets/
[mosaics]: https://winuxnomacs.github.io/dji-thermal-ui-docs/guide/mosaics/
[frames explorer]: https://winuxnomacs.github.io/dji-thermal-ui-docs/guide/frames/
[Measuring]: https://winuxnomacs.github.io/dji-thermal-ui-docs/guide/measuring/
[findings]: https://winuxnomacs.github.io/dji-thermal-ui-docs/guide/findings/
[Reports]: https://winuxnomacs.github.io/dji-thermal-ui-docs/guide/reports/
[compare]: https://winuxnomacs.github.io/dji-thermal-ui-docs/guide/compare/
[exports]: https://winuxnomacs.github.io/dji-thermal-ui-docs/guide/exports/
[WebODM]: https://winuxnomacs.github.io/dji-thermal-ui-docs/guide/webodm/
[First run]: https://winuxnomacs.github.io/dji-thermal-ui-docs/getting-started/first-run/#what-needs-the-internet
[Where the data lives]: https://winuxnomacs.github.io/dji-thermal-ui-docs/reference/data/
