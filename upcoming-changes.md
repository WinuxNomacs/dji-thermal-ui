# Upcoming changes

Deferred work, tracked here so it isn't lost between sessions.

## Phases (current and upcoming)

The order of work, top first. Each phase is planned with the user before it is built; the details are in the
sections below. New requests arrive in `new.md`: they are turned into phases here, and `new.md` is cleared back to
its title.

**Up next**
1. **B: the facelift.** To be planned: A stands alone. (Facelift)

**Then**
- Nothing yet: B is planned first.

**Later**
1. **ODM processing through LuxODM's or WebODM's REST API**: send a conversion's temperature TIFFs as a task with
   the plan's options, and follow it. This replaces the plugin's "Process in LuxODM". (Integration)
2. **Google Map Tiles under the mosaics.** (Basemaps)
3. **A report** of a dataset or a mosaic (moved from LuxODM's Later, 2026-10-25). (Analyzer)

## Standalone (option A)

Requested 2026-10-25: the Thermal Analyzer lives on as a standalone application. LuxODM's plugin will go away.
Interactive work with ODM goes through the LuxODM/WebODM API. A moves the analyzer over, keeping everything it
does that doesn't need LuxODM/WebODM. B (the facelift) is planned once it stands alone.

**Source:** LuxODM at a2a81052 (plugin 0.15.0, 53 Django tests, 143 Jest tests):
- **The plugin:** `coreplugins/thermal-analyzer/`, with `api.py`, `thermal_conversion.py`, `thermal_mosaics.py`,
  `thermal_measure.py` and `thermal_analysis.py`. `thermal_task.py` is not ported. The templates are `datasets`,
  `dataset`, `viewer`, `frame` and `compare`. `public/` has the scripts, `analyzer.css` and `__tests__/`.
- **The models:** `app/models/thermal_dataset.py` (`ThermalDataset`, `ThermalConversion` and
  `ThermalMeasurement`, with their delete signals).
- **The tests:** `app/tests/test_thermal_analyzer_plugin.py`. Its fixture is conversion "Nadir" in dataset "Roof".
- **The ESLint config:** `tools/eslint/`.

### What it keeps

Everything the user does in the plugin today, except the ODM task:
- **Datasets:** datasets of R-JPEGs, uploaded or used in place from a local folder, with their thumbnails.
- **Analysis:** dji-thermal-cli's analysis of a dataset (files, cameras, problems to fix).
- **Conversions:** any of dji-thermal-cli's settings, several conversions side by side, cancel, and download.
- **Mosaics:** as converted, harmonized, source frame and view angle. The viewer has the palette, range,
  brightness and contrast, gamma, equalization and sharpening, with the view kept in the URL.
- **Measurements:**
  - Spot, line and area temperatures, ΔT, boxes and circles, profiles, histograms and isotherms.
  - Saved measurements: compared, measured again with other parameters, and exported as CSV and GeoJSON.
  - Measurements work on mosaics and on single frames.
- **Compare:** the compare page, side by side or as the difference.
- **Preferences:** saved preferences for new datasets, and a reset to the defaults.
- **Downloads:** PNG downloads named `<dataset>-<conversion>-<tab or frame>.png`.

### What it drops

- **Projects and sharing:** datasets are top level, with no project, owner, guardian permissions or sharing.
  `created_by` goes.
- **Accounts:** no login, no quota, and no admin-only folder source (the one user may use any folder).
- **The ODM task:** "Process in LuxODM" goes: `ConversionTaskView`, `thermal_task.py`, the conversion's `tasks`
  link to `app.Task`, the task panel and the task links in `conversions.js`, and the preset saving. The WebODM plan
  (`analysis['webodm']`) is still made by dji-thermal-cli. The conversion settings still compare against it ("off
  the plan"). Only the task panel that used it goes, until the API integration.
- **WebODM's page shell:** its base template and menu, replaced by a layout of the app's own.

### What replaces WebODM's parts

| In the plugin | In dji-thermal-ui |
|---|---|
| `app.api.tiler`: `render_tile`, `point_values`, `colormap_entries`, `parse_rescale`, `check_colormap`, `get_zoom_safe`, `not_modified`, `raster_etag`, `tile_format`, `tile_response` | Copied, with WebODM's notice |
| `app.raster_utils.ZOOM_EXTRA_LEVELS`, `app/raster_stats.py`, `app/measurements.py`, `app/thermal_correction.py`, `app.security.path_traversal_check` | Copied, with WebODM's notice, and their tests too |
| `download_file_response`, `download_file_stream` (`app.api.tasks`) | A small streaming-download helper |
| `UserDataStore` (preferences) | A single preferences row |
| `Basemap.get_cached_basemaps()` | A list in the settings: OpenStreetMap and a satellite layer (Google comes later) |
| `run_function_async` and Celery, `TestSafeAsyncResult` | The job runner (below) |
| `<project dir>/thermal/<id>` | `<data folder>/datasets/<id>`, with conversions under it as before |
| Migrations 0067–0071 and 0073 | One fresh initial migration |
| `login_required`, `visible_datasets`, `get_dataset(…, perm)` | Plain lookups by id |

### Design

- **Layout:**
  - **Code:** `src/dji_thermal_ui/` holds the Django project (`settings.py`, `urls.py`, `wsgi.py`), the CLI
    (`__main__.py`, `cli.py`) and the app `analyzer/` (models, `api.py`, the `thermal_*` modules, the copied
    WebODM helpers in `analyzer/raster/`).
  - **Templates and static files:** in `templates/` and `static/`. Leaflet 1.3.1's `dist` (BSD-2-Clause) is
    vendored in `static/vendor/leaflet/` with its licence. Note that `.gitignore` ignores `lib/`, so nothing is
    put in a `lib/` folder.
  - **Tests:** Python tests in `tests/`, Jest tests in `static/__tests__/`. `package.json` at the root holds Jest,
    jsdom and ESLint, plus leaflet for the tests.
- **URLs:**
  - **API:** keeps the plugin's paths under `/api/` (datasets, conversions, mosaics, measurements, frames and
    preferences, as `plugin.py` mounts them), less `conversions/<id>/task`. The scripts already take the API root
    from `data-api`, so they need no change.
  - **Pages:** `/`, `/dataset/<id>`, `/conversion/<id>`, `/conversion/<id>/frame` and
    `/conversion/<id>/compare?b=<id>`. The compare page drops the "same project" check, so any two conversions can
    be compared.
- **Jobs:**
  - **The runner:** a runner in the server process, a single worker thread fed from a queue. dji-thermal-cli
    already runs its own processes for the heavy work.
  - **Kinds of job:** the plugin's analysis, conversion and mosaic jobs are ported as they are. Each writes its
    status and progress to its row and checks its `run_id` to stop.
  - **On start:** a job left running by a closed server is marked failed with "interrupted".
- **Serving:** `dji-thermal-ui [--data-dir D] [--port P] [--no-browser]` runs migrations, then serves with waitress
  on 127.0.0.1, with threads so tiles load in parallel, and opens the browser. `DEBUG` is off and the secret key is
  made once into the data folder. CSRF stays on, since the scripts already send the token.
- **Tests:**
  - **Python:** the plugin's 53 Django tests run under pytest-django, with the project and permission cases
    removed. Their own tests for the copied WebODM helpers come with them, and the thermal correction and palettes
    tests.
  - **Jest:** the 143 Jest tests are ported, with the task-panel cases removed.
  - **Lint:** ruff, configured like dji-thermal-cli's, and ESLint with the plugin's config.
- **Live data for checks:** dataset 6's 220 M4T frames copied out of LuxODM's Docker volume with `docker cp` into a
  gitignored `ignored/` folder (as dji-thermal-cli does), and added as a folder dataset.

### Decisions (2026-10-25)

- **Platforms:** Linux and Windows. The tests run on both, and the Windows check is done from WSL as for
  dji-thermal-cli.
- **Distribution:** PyPI (`uvx dji-thermal-ui` or pipx), released the way dji-thermal-cli is.
- **Dependency versions:** current releases (rio-tiler, rasterio, numpy 2, Django), pinned exactly. The ported
  code is fixed where they changed.
- **CI:** in A4, tests on push (Linux and Windows), like dji-thermal-cli's `ci.yml`. A release workflow comes once
  a PyPI release is wanted.
- **LuxODM's data:** not imported (A1 planning, 2026-10-25). Datasets are added again from their folders and
  conversions re-run; measurements saved in LuxODM stay there.
- **Tooling:** set up in a fresh VS Code session opened on this repo, standalone from LuxODM's environment
  (A1 planning, 2026-10-25). The list is in "Tooling" below.
- **Permission fields:** `can_change` and `can_delete` are dropped from the API in A2, and the scripts' checks of
  them go in A3 (A2 planning, 2026-10-25).
- **Temperature unit:** an app-wide `unit` in the preferences row, °F by default (A2 planning, 2026-10-25). In
  LuxODM it was the user's profile setting.
- **The look until B:** stock Bootstrap 3.4.1 and Font Awesome Free 5.15.4, vendored, rather than copying WebODM's
  bootswatch theme or writing CSS of our own. Light only: the dark mode comes with the facelift (A3 planning,
  2026-10-25).

## Tooling (set up 2026-10-25, in A1)

Set up in a VS Code session opened on this repo, separate from LuxODM's. Each item is proposed, approved, set up
and then verified (see the user's rules). Personal settings stay in uncommitted files.

- **Python:** uv makes `.venv` with `uv sync` once `pyproject.toml` exists. Develop on Python 3.12, the floor, as
  `.python-version`. CI tests 3.12–3.14.
- **VS Code (local `.vscode/settings.json`, uncommitted):** the interpreter at `.venv`, pytest as the test runner,
  ruff as the Python linter with the project's config (not as a formatter: the ported code keeps its layout), and
  ESLint with the root `eslint.config.*`.
  Extensions needed: Python, Pylance, Ruff (`charliermarsh.ruff`), ESLint.
- **Node:** `npm ci` for Jest, jsdom, ESLint and leaflet (tests only), pinned in `package-lock.json`.
- **Browser checks (A3):** the Playwright MCP, added to this project in local scope (`claude mcp add --scope
  local`), headless Chromium, against `http://127.0.0.1:8765`. It needs no login.
- **Claude permissions (`.claude/settings.local.json`, uncommitted):** `uv sync`, `uv run pytest`, `uv run ruff`,
  `uv run dji-thermal-ui`, `npx jest`, `npm run -s lint`, and `git` status, diff, log and branch, without a prompt
  each time.
- **Windows:** the Windows check runs from WSL with Windows' own git and uv, on a clone on C:, as dji-thermal-cli's
  release check does.
- **`.gitignore`:** add `.vscode/`, `.claude/settings.local.json` and `node_modules/` (`.venv` and `ignored/` are
  already there).
- **Test data:** dataset 6's frames copied out of LuxODM's Docker volume into `ignored/` (gitignored).

## Facelift (option B)

Planned next, now that A stands alone. The idea so far is TypeScript, Vite and OpenLayers, with WebGL colouring of float32
COGs, and `ol/source/Google` for the Map Tiles API.

## Basemaps

- **Google Map Tiles:** the deployment holds the key (decided 2026-10-25). For a locally installed app, a key it
  holds is effectively public. The plan is to proxy tiles through the local server, ship without a key, and read
  it from the config, with a quota. Check first whether Google's terms allow proxying.
- **Esri's satellite layer past its highest zoom** shows "Map data not yet available" tiles under a mosaic zoomed
  in closely (seen in A3's live check). Setting the layer's `maxNativeZoom` would stretch its last level instead.

## Integration

- **ODM through the REST API** (LuxODM or WebODM): authenticate, create a task from a conversion's TIFFs with the
  plan's options, and follow its progress. The plugin's `thermal_task.py` and the task panel in `conversions.js`
  (at LuxODM a2a81052) show what it did.

## Done (kept here briefly as a note, not a tracked deferral)

- **A1: the skeleton** (2026-10-25). The tooling (above), then the package in `src/dji_thermal_ui/`: the data
  folder and secret key (`datadir.py`), settings with SQLite in WAL mode, the three models and `Preferences`
  (`analyzer/models.py`, one initial migration), the job runner (`analyzer/jobs.py`), DRF's CSRF check without users
  (`csrf.py`), and the command (`cli.py`). Leaflet 1.3.1 is vendored in `static/vendor/leaflet/`. Tests: `tests/`
  (pytest; the `flight` test needs `DJI_THERMAL_FLIGHT_DIR`) and `static/__tests__/` (Jest), both passing on Linux
  and on Windows, where dji-thermal-cli's worker processes start fine from the runner's thread.
- **A2: the back end** (2026-10-25). The plugin's API (`analyzer/api.py`, `analyzer/urls.py`, under `/api/`) and its
  `thermal_*` modules, without projects, permissions, quota or the ODM task; downloads with zipstream-ng
  (`analyzer/downloads.py`); WebODM's tiler, colour maps, statistics, correction, path check and the measurement
  functions (on shapely, not GEOS) copied into `analyzer/raster/` with their notices. Temperatures are in the app's
  unit, °F by default, in the preferences. Tests: `tests/test_api_*.py` (the plugin's API tests on fakes),
  `tests/test_raster_*.py` and `tests/test_thermal_correction.py`, and `tests/test_flight.py` on real frames.
  Checked live on the 220 M4T frames: a folder dataset analyzed, converted, made into mosaics (209 frames), then
  points, tiles, a measured and saved area, its CSV and GeoJSON, and the download.
- **A3: the front end** (2026-10-25). Stock Bootstrap 3.4.1 and Font Awesome Free 5.15.4 vendored with their
  licences in `static/vendor/`; the header and the unit in `templates/base.html` and `static/app.js`/`app.css`; the
  five pages (`analyzer/views.py`, `templates/`); the plugin's scripts and `analyzer.css` in `static/`, without
  projects, sharing, permissions or the task panel. Tests: `static/__tests__/` (Jest) and `tests/test_pages.py`.
  Checked live in headless Chromium on the 220 M4T frames: the dataset made, analyzed and deleted; the defaults
  saved and reset; a conversion, its mosaics and the zip; the viewer's tabs, palette, readout, a box measured and
  saved, its CSV, GeoJSON and the PNG export; a frame with a changed distance; compare as the difference; the unit
  switched. No console errors and no failed requests.
- **A4: packaging, release 0.1.0** (2026-10-25). The README and `CHANGELOG.md`; the vendored licences in
  `license-files`; `scripts/check_dist.py` (only the package's own files in the wheel and sdist) and
  `scripts/smoke.py` (the installed command started on a free port and a temporary data folder, its pages and API
  fetched, then the whole process tree stopped); CI in `.github/workflows/ci.yml` (ruff and ESLint, pytest on Linux
  and Windows with Python 3.12 and 3.14, Jest, the build checks, the smoke check of the wheel on both systems),
  publishing nothing. The Windows run found paths stored and zipped with `\` and rows made in the same clock tick
  listed in either order; both fixed on their own branch (`relative()` gives `/`, ordering by `-created_at, -id`).
  `release/0.1.0` sets the version and dates the changelog. Release checks passed on Linux (check_dist, twine,
  smoke on 3.12 and 3.14, ruff, 141 Jest, ESLint, 124 pytest) and on Windows from WSL (124 pytest, the wheel built,
  smoke on 3.12 and 3.14).
