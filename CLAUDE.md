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
- Processing with ODM is not done here. When it comes back, it goes through LuxODM's or WebODM's REST API, never by
  importing their code.

## Rules for this repository

- **Never push and never tag.** A push runs CI (`.github/workflows/ci.yml`: lint, tests on Linux and Windows, the
  build checks and a smoke check of the wheel) and publishes nothing. No workflow publishes yet; when a release
  workflow is added, this line says what a push or a `v*` tag publishes.
- **Licence: AGPL-3.0-only.** The code comes from LuxODM/WebODM (AGPL-3.0) and uses dji-thermal-cli (AGPL-3.0). A
  file copied from WebODM keeps its copyright notice, and its header says where it came from.
- Work is planned in `upcoming-changes.md`. New requests arrive in `new.md` (untracked).
- Dependencies are pinned exactly, in `pyproject.toml` and `uv.lock`, and in `package.json` and `package-lock.json`.
- dji-thermal-cli is the user's own package (`~/gitrepos/python/dji-thermal-cli` on their machine). A change it
  needs is made and released there first, then pinned here.

## Stack

- **Back end:** Python 3.12+, Django and Django REST Framework, SQLite in WAL mode, managed with uv. The package is
  `src/dji_thermal_ui`, and the `dji-thermal-ui` command (`cli.py`) serves it with waitress and opens the browser.
- **Data:** the database, the secret key and the datasets live in a data folder: the platformdirs user data folder,
  `--data-dir`, or `DJI_THERMAL_UI_DATA_DIR` (`datadir.py`). A dataset's files are in `datasets/<id>/`.
- **Jobs:** analyses, conversions and mosaics run in a local job runner (`analyzer/jobs.py`), not Celery:
  `jobs.submit(fn, pk, run_id)`. Each job writes its progress to its row, and is cancelled cooperatively through its
  `run_id`. Tests run jobs inline unless they use the `threaded_jobs` fixture.
- **API:** DRF with no users: `csrf.CsrfCheck` only enforces CSRF.
- **Front end:** TypeScript and Preact with OpenLayers 10.11.0, built by Vite (`vite.config.mts`) from `frontend/src`
  (one entry per page in `pages/`) into `static/dist` with a manifest that `{% vite_entry %}` reads. The pages
  extend `templates/page.html`; the look is `frontend/src/styles/app.css`, light and dark. The build is not
  committed: the wheel and sdist carry it, so installing needs no npm. The app serves its own static files.
- **Map colouring:** the server sends a mosaic's tiles, a difference and a frame as float32 values (`data_response`
  in `api.py`); the browser colours them in WebGL (`frontend/src/map/colour.ts`: palette, range, tone curve,
  isotherm, sharpening), and on a canvas where it draws without a map (`colourValues`). The visual mosaic is the
  exception: PNG tiles from a JPEG copy with overviews (`thermal_mosaics.map_copy`).
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
- Release checks, after `npm run build`: `uv build --no-sources`, `uv run --no-project python scripts/check_dist.py dist`,
  `uvx twine@7.0.0 check --strict dist/*`, then `uv run --no-project python scripts/smoke.py uvx --from <wheel>
  dji-thermal-ui` (the installed command serving its pages). The changelog is `CHANGELOG.md` (Keep a Changelog).
