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

- **Never push and never tag.** No workflow publishes anything yet. When a release workflow is added, this line
  says what a push or a `v*` tag publishes.
- **Licence: AGPL-3.0-only.** The code comes from LuxODM/WebODM (AGPL-3.0) and uses dji-thermal-cli (AGPL-3.0). A
  file copied from WebODM keeps its copyright notice, and its header says where it came from.
- Work is planned in `upcoming-changes.md`. New requests arrive in `new.md` (untracked).
- Dependencies are pinned exactly, in `pyproject.toml` and `uv.lock`, and in `package.json` and `package-lock.json`.
- dji-thermal-cli is the user's own package (`~/gitrepos/python/dji-thermal-cli` on their machine). A change it
  needs is made and released there first, then pinned here.

## Stack (planned in upcoming-changes.md, phase A; update this section as it is built)

- **Back end:** Python 3.12+, Django and Django REST Framework, SQLite, managed with uv. The package is
  `src/dji_thermal_ui`, and the `dji-thermal-ui` command serves it with waitress and opens the browser.
- **Data:** the database and the datasets live in a data folder: the platformdirs user data folder, or
  `--data-dir`.
- **Jobs:** analyses, conversions and mosaics run in a local job runner, not Celery. Each job writes its progress
  to its row, and is cancelled cooperatively through its `run_id`.
- **Front end:** plain ES5 scripts in the UMD pattern with Leaflet 1.3.1, as in the plugin. Leaflet is vendored
  into the static files, so the wheel needs no npm.
- **Tests:** pytest with pytest-django, Jest (jsdom) for the scripts, ruff, and ESLint. All of them run on the
  host.

## Commands (planned; update as they are built)

- `uv sync`, then `uv run dji-thermal-ui` (serves on 127.0.0.1 and opens the browser).
- `uv run pytest`, `uv run ruff check`.
- `npm ci`, then `npx jest` and `npm run -s lint`.
