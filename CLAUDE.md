# CLAUDE.md

What Claude needs to know to work in dji-thermal-ui, a standalone web app for analyzing DJI thermal datasets with
dji-thermal-cli. General working rules (branches, phases, testing) live in the user's own CLAUDE.md; this file holds
what is specific to this repository. It is committed and may be public: nothing private, nothing true only on one
machine. Keep it short; edit in place.

## What it is

- The Thermal Analyzer, moved out of LuxODM (a WebODM fork), where it was the `coreplugins/thermal-analyzer` plugin
  (plugin 0.15.0, LuxODM commit a2a81052). The plugin gets no new features; work on the analyzer happens here.
- One user, on their own computer: the server listens on 127.0.0.1 only, with no login, accounts or sharing.
- Datasets of DJI R-JPEGs are analyzed, converted and made into mosaics with dji-thermal-cli (no ODM needed), then
  viewed, compared and measured in the browser.
- **Names:** what the user sees says Project › Flight › Dataset; the code, URLs, API and database say project ›
  `dataset` › `conversion`. A visible string says flight for a `dataset` and dataset for a `conversion`.
- Processing with ODM is not done here: a conversion's TIFFs are sent to a WebODM of the user's through its REST API
  (`analyzer/webodm.py`, `analyzer/webodm_tasks.py`; "ODM" in `upcoming-changes.md`), never by importing its code.
  WebODM credentials go in `.env`, never in the database (the password encrypted there: its key is in the
  database, `analyzer/encryption.py`), and the pages show them masked.

## Rules for this repository

- **Never push and never tag.** A `v*` tag runs CI (`.github/workflows/ci.yml`: lint, tests on Linux and Windows,
  the build checks and a smoke check of the wheel; a macOS job too while the repository variable `MACOS_CI` is
  `true`, off for now), as does running it by hand; a push to a branch runs nothing.
  Neither publishes anything. No workflow publishes yet; when a release
  workflow is added, this line says what a push or a `v*` tag publishes. A push of the clone of the public
  `dji-thermal-ui-docs` repository publishes the documentation site (GitHub Pages, from its `main`).
- **Licence: AGPL-3.0-only.** The code comes from LuxODM/WebODM (AGPL-3.0) and uses dji-thermal-cli (AGPL-3.0). A
  file copied from WebODM keeps its copyright notice, and its header says where it came from.
- Work is planned in `upcoming-changes.md`. New requests arrive in `new.md` (untracked).
- **The documentation** is `docs/` (Zensical, `zensical.toml`), built into `static/docs` (gitignored), served at
  `/help/` and carried by the wheel; the header's Help opens the guide page for the page shown. A change a user sees
  updates its pages on the same branch: follow `.claude/skills/update-docs`.
- Dependencies are pinned exactly, in `pyproject.toml` and `uv.lock`, and in `package.json` and `package-lock.json`.
- **Linux, Windows and macOS are all supported.** Code that differs by platform is checked on Windows before the
  merge that touches it. A test only a Mac can run is added only where behaviour really differs there, never for
  coverage: the user has to pull and run those by hand.
- dji-thermal-cli is the user's own package (`~/gitrepos/python/dji-thermal-cli` on their machine). A change it
  needs is made and released there first, then pinned here.

## Stack

- **Back end:** Python 3.12+, Django and Django REST Framework, SQLite in WAL mode, managed with uv. The package is
  `src/dji_thermal_ui`, and the `dji-thermal-ui` command (`cli.py`) serves it with waitress and opens the browser.
- **Data:** the database, the secret key and the datasets live in a data folder: `--data-dir` or
  `DJI_THERMAL_UI_DATA_DIR`, else the folder it was moved to from the Storage page (a `data-dir` file in the config
  folder), else the platformdirs user data folder (`datadir.py`). A dataset's files are in `datasets/<id>/`. A move
  is made by the command as it restarts, before it opens the database (`move.py`); `DJI_THERMAL_UI_CONFIG_DIR` keeps
  tests and live checks off the user's config folder.
- **Jobs:** analyses, conversions and mosaics run in a local job runner (`analyzer/jobs.py`), not Celery:
  `jobs.submit(fn, pk, run_id)`; uploads to WebODM, and its orthophotos' downloads, on a second worker
  (`jobs.UPLOADS`). Each job writes its progress to its row, and is cancelled cooperatively through its `run_id`.
  Tests run jobs inline unless they use the `threaded_jobs` fixture.
- **API:** DRF with no users: `csrf.CsrfCheck` only enforces CSRF.
- **Front end:** TypeScript and Preact with OpenLayers 10.11.0, built by Vite (`vite.config.mts`) from `frontend/src`
  (one entry per page in `pages/`) into `static/dist` with a manifest that `{% vite_entry %}` reads. The pages
  extend `templates/page.html`; the look is `frontend/src/styles/app.css`, light and dark. The build is not
  committed: the wheel and sdist carry it, so installing needs no npm. The app serves its own static files.
- **Map colouring:** the server sends a mosaic's tiles, a difference and a frame as float32 values (`data_response`
  in `api.py`); the browser colours them in WebGL (`frontend/src/map/colour.ts`: palette, range, tone curve,
  isotherm, sharpening), and on a canvas where it draws without a map (`colourValues`). The visual mosaic is the
  exception: PNG tiles from a JPEG copy with overviews (`thermal_mosaics.map_copy`).
- **Visual photos** (`_V`, `_W`) are `kind: not_thermal` rows in dji-thermal-cli's analysis, their metadata in
  `FileReport.visual` (`info` is thermal only). The pages call them visual through `fileKind` (front end) and
  `is_visual` (server); never test `kind === "visual"`.
- **Tests:** pytest with pytest-django (`tests/`, settings `tests.settings`, which use a temporary data folder and a
  stub manifest, so they need no build), Vitest with jsdom (`frontend/tests/`), ruff, and ESLint with `tsc`. All of
  them run on the host.

## Commands

- `uv sync`, then `uv run dji-thermal-ui` (serves on 127.0.0.1:8080 and opens the browser; `--data-dir`, `--port`,
  `--no-browser`). `./dji-thermal-ui.sh build|start|stop|restart|status|logs` does the same in the background (PID
  file and log in `.run/`); `tests/test_script.py` tests it with stub uv, npm and curl.
- `uv run pytest`, `uv run ruff check`. Set `DJI_THERMAL_FLIGHT_DIR` to a folder of one flight's R-JPEGs to run
  the `flight` tests too (with its visual `_V` images beside them, the visual mosaic's too).
- `npm ci`, then `npm test`, `npm run -s lint` and `npm run build` (`-- --watch` while working on the pages).
- `uv run --only-group docs zensical build --strict` builds the documentation (`serve` instead of `build` while
  writing it); `scripts/publish_docs.py <clone>` commits it in a clone of the public docs repository, never pushing;
  `npm run screenshots -- <a flight's images>` makes its screenshots again (its own instance on 8081, scratch
  folders; Playwright's Chromium from `npx playwright install chromium`).
- Release checks, after `npm run build` and the documentation's build: `uv build --no-sources`, `uv run --no-project python scripts/check_dist.py dist`,
  `uvx twine@7.0.0 check --strict dist/*`, then `uv run --no-project python scripts/smoke.py uvx --from <wheel>
  dji-thermal-ui` (the installed command serving its pages). The changelog is `CHANGELOG.md` (Keep a Changelog).

## On another machine (macOS too)

- **Needs:** git, uv and Node 24 or newer with npm. Then run `uv sync && npm ci && npm run build`.
  - uv installs Python 3.12 from `.python-version`.
  - On macOS, `./dji-thermal-ui.sh` works as it does on Linux.
  - The default data folder is `~/Library/Application Support/dji-thermal-ui`.
- **What runs on any machine:** the tests above, with nothing else set up.
- **Only on the machine that holds the files:** the flight tests and the live checks on real data.
  - `ignored/` (test flights) and `.env` (a Mapbox token) are not in git; copy them over by hand when they are needed.
  - The data folder, with its database and datasets, is not in git either.
- **CI's macOS job is off** (the repository variable `MACOS_CI` turns it on: its minutes cost ten times Linux's).
  Until it is on, run the full set by hand on a Mac:
  `uv run pytest`, `uv run ruff check`, `npm test`, `npm run -s lint`, `npm run build`, and the release checks.
- **Live checks:** Playwright with Chromium, from `npx playwright install chromium`. macOS needs no host override.
  - Run them on their own instance (`--port 8081 --no-browser`, with `DJI_THERMAL_UI_DATA_DIR` and
    `DJI_THERMAL_UI_CONFIG_DIR` on scratch folders), so an instance the user runs on 8080 keeps running.
  - A check that needs an unreleased dji-thermal-cli uses a scratch venv (`uv venv`, `uv pip install -e .`, then
    the local cli), never `.venv` or `uv.lock`.
  - A report's PATCH merges keys: put one back with `null`, not `{}`.
- **dji-thermal-cli:** its own `CONTRIBUTING.md` explains its test setup.
  - The DJI SDK's sample images run on macOS.
  - The native-SDK comparisons skip there, because the SDK's libraries are Linux x64.
