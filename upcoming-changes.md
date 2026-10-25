# Upcoming changes

Deferred work, tracked here so it isn't lost between sessions.

## Phases (current and upcoming)

The order of work, top first. Each phase is planned with the user before it is built; the details are in the
sections below. New requests arrive in `new.md`: they are turned into phases here, and `new.md` is cleared back to
its title.

**Up next** (planned 2026-10-25: option A, the Thermal Analyzer standing alone)
1. **A1: the skeleton.** The tooling first (Tooling), then the project, settings, data folder, models, job
   runner, and the test and lint setup. Designed 2026-10-25. (Standalone)
2. **A2: the back end.** The plugin's API and `thermal_*` modules ported, with the WebODM helpers they use, and
   their tests. (Standalone)
3. **A3: the front end.** The pages, scripts and Jest tests ported, and the whole flow checked live on real data.
   (Standalone)
4. **A4: packaging.** The command, README, CHANGELOG, release checks, and CI if chosen. (Standalone)

**Then**
1. **B: the facelift.** Planned once A stands alone. (Facelift)

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

### Phase details

- **A1, the skeleton** (designed 2026-10-25; the tooling below is set up first):
  - **Project:** `pyproject.toml` (uv_build, `requires-python >=3.12`, ruff configured like dji-thermal-cli's),
    `uv.lock`, and the LICENSE (AGPL-3.0). Exact pins from PyPI's current releases at build time: Django, Django
    REST Framework, waitress, platformdirs, and dji-thermal-cli 1.4.0. rasterio, rio-tiler and numpy come in A2 with
    the code that uses them. Before pinning, check that rasterio has wheels for 3.12–3.14 on Linux and Windows.
  - **Settings and data folder:** platformdirs' `user_data_dir("dji-thermal-ui")` (`~/.local/share/dji-thermal-ui`,
    `%LOCALAPPDATA%\dji-thermal-ui`), or `--data-dir`. It holds `db.sqlite3`, `secret_key` (made on first start)
    and `datasets/`. SQLite in WAL mode with a busy timeout, since the worker thread writes progress while waitress
    threads read.
  - **Models:** `ThermalDataset`, `ThermalConversion` and `ThermalMeasurement` from the plugin, without `project`,
    `created_by`, `tasks` and `celery_task_id`. A `Preferences` singleton row replaces `UserDataStore`. The delete
    signals, and one initial migration.
  - **Job runner (`analyzer/jobs.py`):** one daemon worker thread on a queue, one job at a time.
    `submit(fn, pk, run_id)` keeps `run_function_async`'s call shape, so A2 swaps it line for line. Cancel and delete
    keep working by changing `run_id`. On start, rows left analyzing, converting or building mosaics are marked
    failed with "interrupted". The runner knows which jobs are alive itself (replaces `job_gone`). Tests run jobs
    inline (eager), as WebODM's tests do with Celery.
  - **CLI:** `dji-thermal-ui [--data-dir D] [--port 8765] [--no-browser]` runs migrations, starts the runner, and
    serves with waitress on 127.0.0.1. A busy port is reported and the command exits. An empty home page for now.
  - **Tests:** the data folder, the secret key kept across starts, the runner (order, progress, cancel,
    "interrupted" on start), the CLI. `package.json` with Jest, jsdom and ESLint (the plugin's config), each running
    a first test.
  - **Windows risk, checked in A1:** dji-thermal-cli starting its own processes (spawn) from a server thread. A small
    job is run through the runner on Windows from WSL before A2 depends on it.
- **A2, the back end:**
  - The `thermal_*` modules and `api.py` ported, with the WebODM helpers copied.
  - The project, permission, task and quota code removed.
  - The Python tests ported, and the API exercised with the fixture conversion.
- **A3, the front end:**
  - The templates on the app's own layout, the scripts and CSS, the task panel removed, and the Jest tests ported.
  - The whole flow checked live in a headless browser: a folder dataset, the analysis, a conversion, its mosaics,
    the viewer, a frame, measurements, the exports, compare, and the downloads. Whatever the check made is deleted
    afterwards.
- **A4, packaging:**
  - The README (install, run, what it does, where the data lives) and CHANGELOG 0.1.0.
  - Release checks: a wheel built and installed into a fresh venv, then run.
  - CI: tests on push, on Linux and Windows. The version is 0.1.0, on a `release/0.1.0` branch.

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

## Tooling (set up at the start of A1)

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

Planned once A stands alone. The idea so far is TypeScript, Vite and OpenLayers, with WebGL colouring of float32
COGs, and `ol/source/Google` for the Map Tiles API.

## Basemaps

- **Google Map Tiles:** the deployment holds the key (decided 2026-10-25). For a locally installed app, a key it
  holds is effectively public. The plan is to proxy tiles through the local server, ship without a key, and read
  it from the config, with a quota. Check first whether Google's terms allow proxying.

## Integration

- **ODM through the REST API** (LuxODM or WebODM): authenticate, create a task from a conversion's TIFFs with the
  plan's options, and follow its progress. The plugin's `thermal_task.py` and the task panel in `conversions.js`
  (at LuxODM a2a81052) show what it did.

## Done (kept here briefly as a note, not a tracked deferral)

Nothing yet.
