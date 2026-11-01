# Upcoming changes

Deferred work, tracked here so it isn't lost between sessions.

## Phases (current and upcoming)

The order of work, top first. Each phase is planned with the user before it is built; the details are in the
sections below. New requests arrive in `new.md`: they are turned into phases here, and `new.md` is cleared back to
its title.

**Up next**:
1. **T1: spelling** (see "Spelling" below): the misspellings fixed, keeping British spelling.
2. **O1: creating the WebODM account** (see "Creating the WebODM account" below), from System Settings › WebODM.

N1 (the name and banner), X1 (platforms) and W1–W3 (the documentation) are built.

**Then**: nothing planned yet.

## Standalone (option A)

Requested 2026-10-25: the Thermal Analyzer lives on as a standalone application. LuxODM's plugin will go away.
Interactive work with ODM goes through the LuxODM/WebODM API. A moves the analyzer over, keeping everything it
does that doesn't need LuxODM/WebODM. B (the facelift) follows, planned in "Facelift" below.

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
| `Basemap.get_cached_basemaps()` | A list in the settings: OpenStreetMap and a satellite layer (Mapbox comes in B3) |
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
  local`), headless Chromium, against `http://127.0.0.1:8080`. It needs no login.
- **Claude permissions (`.claude/settings.local.json`, uncommitted):** `uv sync`, `uv run pytest`, `uv run ruff`,
  `uv run dji-thermal-ui`, `npx jest`, `npm run -s lint`, and `git` status, diff, log and branch, without a prompt
  each time.
- **Windows:** the Windows check runs from WSL with Windows' own git and uv, on a clone on C:, as dji-thermal-cli's
  release check does.
- **`.gitignore`:** add `.vscode/`, `.claude/settings.local.json` and `node_modules/` (`.venv` and `ignored/` are
  already there).
- **Test data:** dataset 6's frames copied out of LuxODM's Docker volume into `ignored/` (gitignored).

## Facelift (option B)

Planned 2026-10-26. The front end (about 6,200 lines of ES5 scripts on Leaflet 1.3.1, Bootstrap 3 and Font
Awesome 5) is rebuilt in two stages, each released on its own.

### Decisions (2026-10-26)

- **Staged:** B1 rebuilds the pages and their look, keeping the API, the server's PNG tiles and Leaflet. B2 then
  moves the viewer to OpenLayers with WebGL colouring.
- **Preact**, in TypeScript, with Vite. No Bootstrap: a stylesheet of the app's own, with CSS variables.
- **Theme:** follows the system's light or dark setting, with a switch in the header that overrides it, saved in
  the preferences.
- **Packaging:** the front end is built at release (`npm ci`, `npm run build`, then `uv build`), in CI and in the
  release checks. The built files are not committed. Building the wheel needs Node; installing it does not.

### B1: the pages rebuilt

- **Source:** `frontend/` at the root (TypeScript, Preact components, the stylesheet), one Vite entry per page.
  The five pages and their URLs stay. Django still renders each page's shell from `templates/` and mounts its
  entry, with the API root and ids in `data-` attributes as today. A small template tag reads Vite's
  `manifest.json` for the hashed file names.
- **Build:** Vite writes `src/dji_thermal_ui/static/dist/` (gitignored), which the app serves and the wheel ships.
  For development, `npm run build -- --watch` beside `uv run dji-thermal-ui`.
- **What moves over:** everything the A3 scripts do, page by page (datasets, dataset, viewer, frame, compare),
  with the same API calls. `analyzer_core.js`'s pure functions become typed modules first, with their tests.
- **Map:** Leaflet stays for B1, upgraded to 1.9.4 with `@types/leaflet`; B2 replaces it.
- **Look:** the app's own CSS: a header, panels and forms, light and dark tokens as CSS variables. The theme is
  set on `<html>` before the page paints, from the preferences or else `prefers-color-scheme`. Icons are inline
  SVG. Bootstrap and Font Awesome are dropped from `static/vendor/`, `license-files` and `check_dist.py`.
- **Preferences:** a `theme` setting (`system`, `light` or `dark`) beside `unit`.
- **Tests:** Vitest with jsdom and Testing Library replaces Jest. The behaviour the 141 Jest tests cover is
  ported. ESLint uses typescript-eslint, and `tsc --noEmit` runs with the lint. pytest's page tests run against
  a stub manifest, so they do not need a build.
- **Packaging:** CI's build job builds the front end first (lint and pytest need no build: the stub manifest).
  `check_dist.py` requires the manifest, each page's entry and its files. A third-party licence file for the
  bundle (Preact, Leaflet) is generated at build and shipped beside it (not in `license-files`: a pattern that
  matches nothing fails the build, and a clone is installed before its pages are built). Checked: the sdist carries the
  built files although they are gitignored, and `uv build` makes the wheel from it with no Node.
- **Versions (npm, 2026-10-26), pinned exactly:** preact 11.0.2, @preact/signals 2.11.3, vite 8.3.5,
  @preact/preset-vite 2.10.6, typescript 6.0.3 (typescript-eslint 8.72.0 supports up to 6.0, so not 7),
  vitest 5.0.5, jsdom 30.1.3, @testing-library/preact 3.2.6, leaflet 1.9.4, @types/leaflet 1.9.22, eslint
  10.13.0.
- **Live check:** A3's walk-through in headless Chromium on the 220 M4T frames, in light and in dark, and on
  Windows from WSL with the smoke check.
- **Release:** 0.2.0.
- **Done:** see Done below.

### B2: the map pages on OpenLayers

Planned 2026-10-27.

- **Decisions (2026-10-27):** sharpening is done in the browser's shader, not on the server; the frame page moves
  to OpenLayers too, so Leaflet is dropped.
- **Map:** OpenLayers 10.11.0 (released 2026-10-04) replaces Leaflet on the viewer, compare and frame pages: the
  basemaps (XYZ and WMS) and their switch, the scale bar, the legend, drawing measurements, the outlines and the
  PNG export. Mapbox's satellite tiles come in B3 (Basemaps).
- **Data tiles, not COGs:** the server sends float32 tiles (raw little-endian, -1e30 where there is no data, as
  WebGL cannot test for NaN, with the same ETags) of what is drawn today: a mosaic tab's values read with rio-tiler (nearest pixel), temperatures
  corrected for the emissivity and reflected temperature asked; the difference of two conversions; a frame's
  temperatures as measured (with its changes). So the mosaics stay as dji-thermal-cli writes them (strip-laid,
  five float32 bands, no overviews) and need no change there.
- **Colouring in the browser:** a WebGL tile layer (`ol/layer/WebGLTile` over `ol/source/DataTile`) colours them
  with a style built from the view: the palette (the API's colours), the range, gamma, brightness and contrast,
  the isotherm (its pixels in the palette, the rest grey), the source frames each in their colour. Changing any of
  these redraws without new tiles. Equalization applies the curve the server already gives (`/curve`), sampled
  into the style.
- **Sharpening** in the shader: the unsharp mask on the toned values, from neighbouring pixels read with the
  style's band offsets (`['band', 1, dx, dy]`), its reach in tile pixels from the zoom as on the server. Tiles carry
  a gutter (`DataTile`'s `gutter`) as wide as that reach, so tile edges show no seams. A hand-written shader only
  if the style's expressions prove too limited.
- **On the server's API still:** point readouts, measurements, the histogram and curve, the downloads. The
  server's PNG tiles and frame images, and the colouring code only they use, are removed once nothing calls them.
- **Tests:** the style builders, the curve's sampling, the tile decoding and the drawing's geometry in Vitest (jsdom
  has no WebGL); the data tiles in pytest (shape, gutter, no data, correction, difference, ETag). The look is
  checked in headless Chromium (software WebGL), compared side by side with 0.2.0's server-drawn tiles.
- **Live check:** A3's walk-through on the 220 M4T frames, in light and in dark, and the Windows check.
  Done 2026-10-27: the viewer, compare (side by side, linked, and the difference of the as converted and harmonized
  mosaics) and frame pages draw in headless Chromium with software WebGL, with no errors; hovering, the isotherm,
  sharpening and the frame locator work. The look matches 0.2.0's, Esri's missing tiles included (see Basemaps).
  pytest passes on Windows from a clone of the branch.
- **Release:** 0.3.0.
- **Done:** see Done below.

## Basemaps

### B3: the basemaps

Planned 2026-10-27, changed the same day from Google to Mapbox.

- **Decisions (2026-10-27):** this replaces the note of 2026-10-25 (a key the deployment holds, tiles proxied
  through the server, the app counting a quota). That note was written for LuxODM's shared server. Here there is
  one user on their own computer, with their own token:
  - Mapbox, not Google: Google needs a Cloud project with billing before any tile is served. Each user makes their
    own Mapbox account and token. Alternatives looked at: MapTiler and Stadia (free plans non-commercial only),
    Esri's Location Platform (more steps to sign up), Bing (retired), Azure (billing). OpenStreetMap and MapLibre
    have no imagery.
  - The browser fetches Mapbox's tiles directly, with no proxy.
  - The token is entered in the app and saved in the preferences. A `MAPBOX_API_TOKEN` in the environment or in a
    `.env` file is used too, for whoever sets the app up (the order is below).
  - Esri's layer gets a maximum zoom for each area.
  - The app counts no usage: the Mapbox account's own free tier limits it.
- **Mapbox's terms (checked 2026-10-27):** Mapbox's tiles need the Mapbox wordmark and the text attribution
  ("© Mapbox", "© OpenStreetMap", "Improve this map" at the place shown, and "© Maxar" for the imagery) while they
  are shown. The wordmark may be moved to another corner but not styled. Free allowances (mapbox.com/pricing):
  750,000 tiles a month on the Raster Tiles API, 200,000 on the Static Tiles API.
- **Mapbox Satellite:** an XYZ layer of 512-pixel tiles of the `satellite-v9` style through the Static Tiles API
  (`https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/512/{z}/{x}/{y}?access_token=…`), up to zoom 22.
  - The Raster Tiles API (`v4/mapbox.satellite`) was the plan, but on 2026-10-27 it answered the user's account
    (no card) with 429 and a limit of -1, while the Static Tiles API served the same token.
  - Shown as "Mapbox Satellite" in the basemap switch when a token is known.
  - The wordmark is a map control at the bottom left, above the scale line, and the attribution (not collapsible)
    goes in the attribution control, while the layer is shown. The wordmark is Mapbox's map wordmark, unmodified,
    from Mapbox GL JS 1.13.3 (BSD-3-Clause), in `static/vendor/mapbox/` with its licence.
  - If its tiles are refused (401 for a wrong token, 403 for one restricted to other URLs, 429 past the limits),
    the switch says why, and the map goes back to the previous basemap.
- **The token:** "Mapbox Satellite: add a token…" in the basemap switch opens a small form to paste the token.
  - The form says how to get one (asked for by the user, 2026-10-27): sign up at mapbox.com (no card needed, the free
    allowance, and charges only once a card is on the account), copy the Default public token from the Access tokens page (or make one
    with the public scopes only, never a secret one), paste it. It says the token stays in the app's preferences and
    goes to Mapbox with each tile, links to the Statistics page for the usage, and says when `MAPBOX_API_TOKEN` is
    the one in use. The README has the same steps.
  - Saved as the `mapbox_token` preference (`PUT /api/preferences`), never in the code or a committed file, and
    reaches the map pages in their JSON. The same form changes or removes it.
  - Only a public token (`pk.`) is accepted. A secret one (`sk.`) is refused, since the browser shows it to anyone
    looking.
  - `MAPBOX_API_TOKEN` is read from the environment, or from a `.env` file in the folder the app is started from or
    in the data folder (only that line is read; no new dependency). `.env` is in `.gitignore`.
  - Which one is used: the token saved in the app, else `MAPBOX_API_TOKEN`. The form says when the token in use
    comes from `MAPBOX_API_TOKEN`, and removing the saved one goes back to it.
  - Tests never read the real `.env` or environment token: the test settings clear `MAPBOX_API_TOKEN` and point the
    `.env` lookup at the temporary folder.
- **Esri past its levels:** Esri's satellite imagery goes as deep as zoom 21 in some places and only to 17–19 in
  others. Past that, it serves "Map data not yet available" tiles.
  - The layer asks Esri's tilemap service (`MapServer/tilemap/{z}/{row}/{col}/{w}/{h}`) which tiles exist around
    the mosaic, at most once per block and level, and requests none that do not exist.
  - Where tiles are missing, the deepest level that exists is stretched (the tile grid's lower levels).
  - First check when building: the endpoint and its answer. Esri's server returned 502s on 2026-10-27.
  - If the tilemap cannot be read, or does not answer within 5 s, the layer stops at zoom 19 there and is
    stretched past it.
  - Checked 2026-10-27: the tilemap answers (with CORS), and over the M4T dataset Esri has tiles to zoom 19 only.
  - A tile the tilemap says is missing is left in OpenLayers' error state, and the layer preloads 4 levels, so the
    renderer draws the deepest loaded level above it in its place.
  - Mapbox gets the same stretching past its deepest level if its tiles show the same problem.
- **Usage limits:** none in the app. Mapbox's URL restrictions accept no IP addresses (the app is on 127.0.0.1)
  and the default public token cannot be restricted, so the README says to use a public token, unrestricted, and to
  watch the Statistics page.
- **Tests:**
  - Vitest:
    - the basemaps listed with and without a token;
    - the token form saving, changing and removing the token, and saying when it comes from `MAPBOX_API_TOKEN`;
    - the switch going back when the tiles are refused (the tile request stubbed);
    - the tilemap's answer turned into the levels each tile has.
  - pytest: the preference saved, removed and passed to the pages; an empty, overlong or secret token refused;
    `MAPBOX_API_TOKEN` from the environment and from `.env`, and the saved token winning over it.
- **Live check:** the viewer and compare pages on the 220 M4T frames, in light and in dark.
  - Esri zoomed in past its levels, with no placeholder tiles.
  - Mapbox with the user's token from `.env` (given by the user for this; never printed or copied). The wordmark
    and attribution are shown, and a wrong token saved in the form is reported, then removed.
  Done 2026-10-27: Esri over the M4T site stretched from zoom 19 with no deeper tile requested; Mapbox's tiles to
  zoom 22 with the wordmark and the open attribution, on the viewer and both maps of the compare page; the form in
  light and dark, a secret token refused, a wrong one reported (401) and the map back on Esri. Found and fixed: the
  Raster Tiles API's 429 (above), and OpenLayers' attribution control counting hidden layers, so the switch sets it
  open only while Mapbox is shown.
- **Release:** 0.4.0 (a feature).
- **Done:** see Done below.

### N2: the Mapbox token in System Settings

Asked for on 2026-10-29: the switch still offered "Mapbox Satellite: the token…" once a token was known. This
replaces B3's "The token" above (the form in the switch, the `mapbox_token` preference).

- **Where:** System Settings gets a page of its own (`/settings`, its name in the navigation pane a link to it;
  Storage stays under it). Clicking the name opens the page and folds or unfolds it too, as the user
  asked on 2026-10-29; the chevron only folds. Its "Mapbox Satellite" section says whether a token is known and where from (shown
  shortened: `pk.` and its last characters), has the steps to get one (B3's), and a field to paste a new one.
- **The basemap switch** lists the basemaps and None only. A refused token's message points to System Settings.
- **Where it is kept:** `MAPBOX_API_TOKEN` in a `.env` file, no longer in the preferences.
  - Saving overwrites the token in the `.env` it was read from (only that line; the file's other lines kept), else
    adds it to the data folder's `.env` (made, readable by the user only). No earlier token is kept, and there is
    no Remove: a token can only be replaced.
  - A `MAPBOX_API_TOKEN` in the environment wins over the files, so then the page shows it and cannot change it.
  - A token saved in the preferences by an earlier version is moved to the data folder's `.env` when the server
    starts (unless a `.env` or the environment already has one), and the preference is removed.
- **The check:** before anything is written, the server asks Mapbox for one tile of the imagery the maps use
  (Static Tiles API, `0/0/0`). 200 saves it; 401, 403 or 429 is said as in the switch; no answer in 10 s or no
  connection says Mapbox could not be reached. The format check (public `pk.` token only) comes first.
- **API:** `api/settings/mapbox` (GET the state, PUT `{token}`); `mapbox_token` leaves `api/preferences`.
- **Tests:** pytest for the `.env` written (replaced in place, other lines kept, made in the data folder), the
  check's answers (Mapbox stubbed), the environment's token not changeable, the old preference moved; Vitest for
  the switch without the token entry and the settings page (save, refusal, environment); the navigation's link.
- **Live check:** on 8081 started outside the repository with a temporary data folder (so the repository's `.env`
  is not written): a wrong token refused by Mapbox and nothing written; the user's token (read from the repo's
  `.env` by the script, never printed) accepted and written; the viewer then showing Mapbox; light and dark.
- **Done:** see Done below.

## Findings

Requested 2026-10-27 (`new.md`) and put before the reports at the user's request:
- **Findings on datasets:** on the As converted and Harmonized tabs, a spot or an area drawn on the mosaic opens the
  source frames that made it, in a window on the page: the whole frame, and a list to pick another when there are
  several. The user inspects them and can save the spot or area as a finding, its source frames kept with it. The
  same on the compare page. Findings can be shown or hidden, and a measurement can be saved as a finding.
- **The Source frame tab:** clicking it only outlines the frame today; it should open the frame in the same window.

### Decisions (2026-10-27)

- **Which frames:** every frame that saw the spot or area, not only the one the mosaic took each pixel from (that
  one is listed first). The mosaic does not record the others, so dji-thermal-cli saves them first (C1).
- **Kept by reference:** a finding stores its frames' names, where the spot or area is in each, and which ones the
  user kept. The pictures stay in the dataset; nothing is copied.
- **What a finding holds:** its shape (a spot or an area, in lon/lat), a name, notes, a severity (low, medium, high,
  critical), a status (open, reviewed, resolved), the temperatures measured when it was saved (min, max, mean, ΔT,
  with the conversion and tab they were read on), and its frames.
- **Findings belong to the dataset:** in lon/lat, they show on every conversion's mosaics of that dataset and on
  both panes of the compare page.
- **The name:** dji-thermal-cli's analysis also has "findings", which the app shows as Problems. They stay Problems;
  the front end's type for them is renamed `Problem` so that `Finding` is the new one.

### C1: frame models in dji-thermal-cli

- **Built** (2026-10-27): see Done.

- **In dji-thermal-cli** (`~/gitrepos/python/dji-thermal-cli`, its own branch, tests and release 1.5.0, a feature):
  - The mosaic writes how each placed frame sees the ground beside its rasters: the camera position and height,
    its rotation, principal point and focal length, the alignment correction (shift and rotation), the surface it
    was projected onto, and its corrected footprint in lon/lat.
  - A public function takes those and ground points (lon/lat) and gives each frame's pixel for them, or none where
    the frame did not see the point; another gives the frames whose footprint covers a point or meets an area.
  - Its tests: a ground point projected into a frame and back lands where it started; points outside the footprint
    give none; the file is written and read back.
- **Here:** dji-thermal-cli pinned at 1.5.0. Mosaics built before it have no frame models: for them the pop-out
  lists only the frames the mosaic used (the Source frame raster) and says that rebuilding the mosaics lists every
  frame that saw it.
- **First check when building:** that the model reproduces the mosaic's own sampling (a pixel of the Source frame
  tab maps to the same frame pixel as `frame_pixel` today).

### C2: the source frames pop-out

- **Built** (2026-10-27): see Done.
- **Decided with the user (2026-10-27):** besides the tool, a saved spot, box, circle or area measurement has a
  "Source frames" button, so a shape drawn once need not be drawn again; 0.5.0 is released after C2, as planned.
- **The frame is shown as converted** (the frame page's values) on every tab, coloured with the tab's palette and
  range, as the compare page's picked point does today.
- **A "Source frames" tool** on the viewer's As converted, Harmonized and Source frame tabs: a spot (a click) or an
  area (a polygon, as the Area tool draws). On the Source frame tab a click opens it directly, as asked.
- **The window:** on the page, beside the map (not a browser pop-up), movable and closable. It shows the whole frame,
  coloured with the mosaic's palette and range, with the spot marked or the area outlined in the frame's pixels;
  and the list of frames that saw it, the one the mosaic used first, each with its time and view angle. Picking one
  in the list (or ← and →) shows it; a link opens it on the frame page.
- **API:** `POST …/mosaics/<tab>/sources` with the geometry: the frames that saw it, for each the spot's pixel or
  the area's outline in its pixels, whether the mosaic used it, and what share of the area it covers.
- **Compare page:** its "Picked point" panel is replaced by the same window, for each pane (A's and B's frames for
  the difference).
- **Tests:** pytest for the endpoint (a spot, an area, outside the mosaic, a mosaic without frame models); Vitest
  for the window (the list, stepping, the marked spot and outline, closing).

### C3: findings on the viewer

- **Built** (2026-10-27): see Done.
- **Decided with the user (2026-10-27):**
  - **The project side too:** the projects page and the project page show findings counts, and the project page
    lists its datasets' findings, each opening the viewer on the conversion it was measured on (or the dataset's
    latest with mosaics when that one is gone).
  - **Drawn as an outline with a severity tag:** the shape in a white-and-black dashed outline that reads on any
    palette (a spot as a ringed dot), labelled with a chip in the severity's colour holding the name.
  - **Frame measurements are not saved as findings** (they are in the frame's pixels): only a mosaic's spot or
    area, from a saved measurement or the source frames window.
- **The conversion measured on** is kept as a link that empties if that conversion is deleted; the finding stays.
- **Model:** `Finding` on the dataset, with the fields above, its frames as a list ({frame, pixel or outline, kept}),
  and when it was made and changed. API: list, create, change and delete under `/api/datasets/<id>/findings`.
- **Saving:** the pop-out's "Save as finding" opens a form (name, notes, severity, status, the frames to keep, all
  ticked to start with); the temperatures are measured then on the tab shown. A saved measurement that is a spot or
  an area (box and circle included; a line cannot be) has "Save as finding" too, its geometry and figures copied.
- **On the map:** findings drawn in their own style (by severity), labelled, a click opening the finding with its
  frames in the pop-out. A "Findings" switch shows or hides them all, kept in the URL, and each can be hidden from
  the list.
- **The list:** a Findings section in the viewer's panel (name, severity, status), to open, change or delete one.
  The dataset page shows how many findings the dataset has.
- **Tests:** pytest for the API (create, change, delete, the dataset's deletion removing them, refused values);
  Vitest for the form, the list and the switch.

### C4: findings on the compare page

- **Built** (2026-10-27): see Done.
- Findings shown on both panes with their own switch, opened in each pane's pop-out, and saved from a spot or area
  drawn in a pane.
- **Decided with the user (2026-10-27):**
  - **A difference pane** draws A's and B's datasets' findings (once when they are the same dataset); in its window
    each mosaic's frames (A, B) have their own "Save as finding", saved to that mosaic's dataset and measured on it.
  - **One switch for both panes**, in the page header, kept in the URL.
  - **Open and change only:** a finding opens in the pane's window with Change (C3's form) and a link to it in the
    viewer; deleting, hiding one by one and the list stay in the viewer.
- **Each pane** draws its mosaic's dataset's findings in C3's style; a click on one opens it in that pane's window
  with its kept frames. The finding open is kept in the URL, so a link opens it on the compare page too.
- **Drawing:** the pane's "Source frames" button becomes Spot (as today) and Area (a polygon, the viewer's drawing);
  the window's "Save as finding" opens C3's form, the temperatures read on that pane's mosaic as converted.
- **Tests:** Vitest for the switch and the URL, a finding opened by a click and by a link, saving from a pane and
  from each mosaic of a difference, and changing one.

### Each phase

- Live check on the 220 M4T frames in a real browser, light and dark, leaving no findings behind.
- Release: C1 is dji-thermal-cli 1.5.0 (the user pushes and tags it there), then here 0.5.0 after C2 and 0.6.0
  after C4, unless the user prefers one release at the end.

## Reports

Planned 2026-10-27, from Later ("a report of a dataset or a mosaic"), after the findings.

### Decisions (2026-10-27)

- **Two reports:** a dataset report and a mosaic report.
- **Printed to PDF from the browser:** a report page laid out for A4 and Letter; the user prints it and picks "Save
  as PDF". It uses the viewer's own colouring and drawing, adds no dependency, and works the same on Windows.
- **The mosaic report holds:** the mosaic as shown (the viewer's tab, palette, range and adjustments, with the saved
  measurements drawn and labelled, the colour scale, a scale bar and north); the measurements' table and their
  charts (profiles, histograms); a close-up of each measurement (frame measurements on their frame); and the
  settings and method (the conversion's settings, the mosaic kind, dji-thermal-cli's version).
- **Text of the user's own, saved:** a title, author, date and notes on each report, and a comment on each
  measurement, typed on the report page and saved.

### D1: the dataset report

- **Built** (2026-10-28): see Done.

- `/dataset/<id>/report`, opened from the dataset page: the title block; the dataset (files, size, thermal frames,
  cameras, when it was flown, altitudes, where, with the frames' positions on a map); the problems from the analysis;
  the frames' settings and temperature ranges; the conversions made; and, once C3 is built, the findings.
- The report's text saved on the dataset. Print styles: no header or controls, always light, figures kept whole on
  a page.
- **Decisions (2026-10-28):**
  - **The frames:** a summary in the body: each setting's distinct values with their frame counts (emissivity,
    distance, humidity, reflection, ambient), and the lowest, median and highest of the frames' temperatures. A full
    table of the frames is an appendix, switched on per report, and the switch is saved.
  - **The author:** typed on the report; the last one used is kept in the preferences and fills in new reports.
  - **The findings:** a table, each numbered on the frames' map, with thumbnails of their kept frames.
  - **The WebODM plan:** its coverage figures only. The task options and commands stay on the dataset page.
- **Built as:** the text in a `report` field on the dataset (title, author, date, notes, appendix), changed with
  the dataset's PATCH; the page `/dataset/<id>/report` (`frontend/src/report/`), with a Report button on the dataset
  page and a Report entry in the navigation pane; print styles in `app.css`.

### D2: the mosaic report

- **Built** (2026-10-28): see Done.

- `/conversion/<id>/report`, opened from the viewer with its view: the contents decided above, and the dataset's
  findings on this mosaic with their kept frames. Each measurement's comment saved on the measurement (shown in the
  viewer and in the CSV and GeoJSON too).
- Tests for both: pytest for the pages and the saved text; Vitest for the sections from the data; a live check
  printing each to PDF with Playwright and looking at the pages.
- **Decisions (2026-10-28):**
  - **The view** (tab, palette, range, adjustments) is saved with the report. The viewer's Report button saves the
    view it shows, then opens the report; the pane's entry opens the saved view.
  - **The mosaic on white**, as in the PNG export: the coloured mosaic with the measurements and findings drawn on
    it, the colour scale, a scale bar and north. No basemap.
  - **The measurements:** every saved measurement of the conversion, on the mosaics and on frames. A switch on the
    report leaves one out, and the switch is saved.
  - **The findings:** every finding of the dataset that lies on the mosaic, numbered on the figure, with the
    conversion its temperatures were read on and its kept frames.
- **Design:**
  - **Text and view:** a `report` field on the conversion (title, author, date, notes, view, left out), changed with
    its PATCH like the dataset's. The author is shared with D1 (`report_author`).
  - **The figures are images:** WebGL canvases do not print reliably. A hidden map draws the mosaic (`ThermalLayer`)
    fitted to the mosaic, then to each measurement's extent, and `snapshot` and `viewCanvas` (the PNG export's)
    make each into an image on the page. Frame measurements are drawn on their frame (`frameMap`, the frame's
    values).
  - **The measurements' table and charts:** `Profile` and `Histogram` (SVG, which prints).
  - **A comment on each measurement:** a `comment` field, typed on the report, shown in the viewer's saved list, in
    the CSV and the GeoJSON.
  - **Settings and method:** the conversion's settings that differ from the defaults (`settings.ts`), the mosaic's
    kind and what it means (`TAB_HINTS`), the normalization, and dji-thermal-cli's version (each conversion's
    results already record it).

## Projects

Requested 2026-10-27 (`new.md`):
- **Projects:** a project contains datasets, and has a name, a description and a location. The location is found by
  searching OpenStreetMap or Mapbox for an address or a place on the map. Everything about a project's datasets,
  findings included, is available across the project, so its datasets can be compared with each other.
- **A navigation pane:** collapsible, on the left, to move between projects, their datasets and what is under them,
  with User Preferences as an entry: the unit temperatures are shown in (°C, °F, K), the theme (light, dark), and the
  locale times are shown in, the computer's by default.

### What it builds on

- **Datasets** have no container today: the datasets page lists them all. A dataset's conversions, mosaics,
  measurements and (after C3) findings hang off the dataset, so a project only has to hold datasets.
- **The compare page** can already pair any two conversions, from any dataset: within a project it can offer that
  project's conversions first.
- **The unit and the theme** are already chosen in the header and saved for the app (`Preferences`); times are shown
  with the browser's locale (`toLocaleString` in `core/format.ts`). The preferences page gathers these, and adds the
  locale.
- **Basemaps** (B3): OpenStreetMap and, with the user's token, Mapbox. Both have a search service (Nominatim, and
  Mapbox's geocoding), which the location search would call from the browser.

### Decisions (2026-10-27)

- **Order:** projects first, before the rest of the findings (C2–C4) and the reports, since they change the scope
  of everything else: findings and reports are then seen within a project.
- **The Default Project:** made whenever no project exists (on the first start after E1, and again if the last
  project is deleted). Datasets made before projects go into it. It is an ordinary project: the user renames it and
  fills in its description and location.
- **Deleting a project** deletes its datasets with it (their files, conversions, mosaics, measurements and
  findings), after a confirmation that says how many datasets and how much disk space go with it.
- **Place search:** OpenStreetMap's Nominatim, with or without a Mapbox token (changed 2026-10-27, while building E2:
  Mapbox's geocoding results may not be stored unless asked for as its permanent geocoding, which needs a card on
  the account and is billed per request, and may only be used with a Mapbox map; Nominatim's are OpenStreetMap's
  data, kept under the ODbL with the credit). The search text, or the point clicked, goes to Nominatim; nothing else
  leaves the computer.
- **The location:** one point with its address or place name, the general site where the project's flights are made
  (a parcel with several buildings or silos). No outline.
- **Unit and theme** stay in the header as quick switches, and are on the preferences page too.
- **Locale:** dates and times only, not numbers. The locale's format is the computer's by default, or one chosen on
  the preferences page. A flight's times are shown in the time where the flight was made: the offset of the
  frames' local capture time (EXIF DateTimeOriginal) from their UTC time (DJI's UTCAtExposure), rounded to 15
  minutes as the two clocks differ by seconds (the 220 M4T frames: 08:44:42 against 13:45:01.8 UTC, so UTC−5), so
  no time zone database is needed; the times of the app's own events (made, changed) stay in the computer's time.

### E1: projects

- **Built** (2026-10-27): see Done. The findings counts and the project's findings together came with C3; the form
  edits the name and description, and the location's form is E2's.
- **Model:** `Project` (name, description, location as lon/lat with its label, when made and changed), and each
  dataset in exactly one project. The migration makes the Default Project and moves the existing datasets into it.
- **API:** `/api/projects` (list, create, change, delete with its datasets); a dataset's `project`, changed to move
  it. A new dataset is made in the project it was started from.
- **Pages:** a projects page as the new home (each project with its location, dataset count and findings count),
  and a project page with its datasets (their conversions and findings counts), the project's findings together
  (once C3 is built), and the flight areas on a map. The compare page lists the project's conversions first.
- **Tests:** pytest for the model, migration and API (the Default Project made when none exists, a dataset moved,
  deleting a project and its datasets' folders, refused values); Vitest for the pages' lists and the delete
  confirmation.

### E2: the location

- **Built** (2026-10-27): see Done.
- On the project's form: a map with the basemaps of B3 and a search box; results from Nominatim (one search a second
  at most, on Enter, with the app's name as its user agent as Nominatim's usage policy asks: the server asks it, since
  a browser cannot set the user agent), with the service named under the results. A result, or a click on the map (reverse-geocoded
  for its label), sets the point; the label can be edited.
- **Tests:** pytest for the location's values; Vitest for the search (each service, no token, no results, a failed
  request) and setting the point.

### E3: the navigation pane and preferences

- **Built** (2026-10-27): see Done. The fallback changed while building: a frame's capture time is the drone's own
  clock, not UTC, so without the UTC time it cannot be shown in the computer's time; it is shown as recorded and
  labelled "time zone unknown" with why (the images do not record both times, or the dataset was analyzed before the
  UTC time was kept: analyze it again). The PNG exports keep their fixed date format, with the zone added.
- **The pane:** on the left of every page: the projects, under each its datasets, under each its conversions (with
  their viewer, compare and, later, report pages), and User Preferences last. Collapsible by level and as a whole
  (kept for the next visit), the current page highlighted, and over the page on narrow screens.
- **User Preferences:** a page with the unit and the theme (as in the header), and the date and time locale (the
  computer's, or one chosen from a list), applied to every date and time shown.
- **Flight times:** a dataset's capture times are shown in the flight's local time (the offset above), labelled
  with it (e.g. "UTC−5"); a dataset without both times falls back to the computer's time and says so.
- **Tests:** pytest for the preference and the flight's offset; Vitest for the pane (levels, collapsing, the current
  page) and the date formatting (locale, offset, fallback); a live check in the browser, light and dark, at desktop
  and narrow widths.

## Controls

Asked in `new.md` (2026-10-27): the image should change while the brightness, contrast, gamma and other sliders are
dragged, not only when they are let go, and the sliders should be 5% less sensitive; the temperature scale should
show the minimum and maximum at its ends.

### What it builds on

- The browser colours the tiles since B2 (`frontend/src/map/colour.ts`), so redrawing while dragging needs no request
  to the server. Today the viewer and frame pages move the range fields and the scale while brightness, contrast or
  gamma is dragged, and colour the map when the slider is let go; sharpening, and every slider on the compare page,
  act only when let go.
- The scale (`ScaleView` in `viewer/panel.tsx`, and the PNG download's legend in `viewer/canvas.ts`) labels round
  ticks (`scaleTicks` in `viewer/view.ts`), so its ends are labelled only when a tick falls on them.

### Decisions (2026-10-27)

- **Sensitivity:** smaller steps, same reach: each slider's step is 5% smaller, and its ends stay where they are.
- **The scale's ends:** labelled with the range's ends (the exact values the palette's ends stand for, to 0.1), with
  the round ticks between them; a tick too close to an end is dropped. On every scale, the download's legend included.
- **Order:** before C3, then released as 0.5.1.

### F1: live sliders and the scale's ends

- **Built** (2026-10-27): see Done.
- **Live:** brightness, contrast, gamma and sharpening redraw the image while dragged, on the viewer, frame and
  compare pages; what is kept (the style saved, an equalized tone curve asked of the server) waits until the slider
  is let go, as today.
- **Steps:** about 5% finer, and a whole number of them from end to end so that both ends are reached: brightness
  0.05 → 2/42, contrast 0.1 → 4/42, gamma 0.1 → 4.6/48, sharpening 0.5 → 5/11 (9% finer: its 10 steps cannot be
  5% more and stay whole).
- **Scale:** `scaleTicks` gives the two ends as well as the round ticks between them.
- **Tests:** Vitest for the ticks (ends, ticks near an end dropped) and the sliders (the image's style changes while
  dragging); a live check in the browser, light and dark.

## RGB and thermal

Requested 2026-10-28 (`new.md`):
- dji-thermal-cli should make mosaics of DJI's non-thermal (visual, RGB) images too. The Matrice 4T and the Zenmuse
  H20T/H30T series capture a route in thermal and visual at once, and comparing the visual and thermal mosaics, and
  their frames, would help in the app.
- The app should compare visual and thermal mosaics, building on the first. dji-thermal-cli's changes stay separate
  from the app's: the CLI must always work standalone, and the app uses its Python API (`api.py`) rather than
  duplicating its work.

### What it builds on

- **dji-thermal-cli 1.5.0 (`mosaic.py`)** builds mosaics without ODM:
  - **Placement:** each frame is placed from its pose (GPS, height and gimbal angles read from its XMP by `read_pose`).
    The camera's focal length in pixels comes from `focal_length_px(model, ...)`.
  - **Refinement:** the placements are refined by aligning overlaps with phase correlation, optionally over a DSM.
  - **Output:** a single-band float32 temperature GeoTIFF with frame models (each frame's footprint, for the source
    frames).
  - **What carries over:** posing, placing, the grid, the DSM and the frame models do not depend on what a pixel
    holds. Compositing, normalization, the PNG views and the alignment's input are specific to temperatures.
- **dji-thermal-cli's analysis** already recognizes a visual image: a valid JPEG without thermal data is
  `not_thermal` (`dataset.py`). DJI names a capture's pair `..._0001_T.JPG` and `..._0001_V.JPG` (and `_W`/`_Z` for the
  wide and zoom cameras on some drones).
- **The app:**
  - **Datasets:** they keep every uploaded JPEG and list the visual ones as "not thermal". The Files tab shows them.
  - **Mosaics:** the viewer and compare page take a mosaic's float32 data tiles and colour them in WebGL. A visual
    mosaic needs RGB tiles instead: the server's PNG/JPEG tiles, or the image itself as a tile layer.
  - **Compare page:** two panes kept in step (`compare/`), which F3 would extend with a visual pane, a swipe or an
    overlay.
  - **Source frames window and frame page:** they show the thermal frames that saw a spot. The paired `_V` frame
    could be shown beside each one.
- **Test data:** the 220 M4T frames in `ignored/` and dataset 1 are thermal only. A flight with both `_T` and `_V`
  images is needed for development and the live checks.

### Proposed phases

- **F1 (dji-thermal-cli, its own repo and release, e.g. 1.6.0):** visual mosaics.
  - **Frames and cameras:** read the visual frames' poses (the same XMP), and the intrinsics of the visual cameras of
    the supported drones (M4T wide; M3T, H20T and H30T wide), with tests.
  - **Pairing:** pair `_V` with `_T` by capture.
  - **Compositing:** an RGB composite (uint8, 3 bands with alpha) at a chosen GSD.
  - **Placement:** optionally use the thermal mosaic's refined placements (the pair shares a gimbal), so the two
    mosaics line up.
  - **Output:** a GeoTIFF with frame models.
  - **Interfaces:** a CLI option (e.g. `mosaic --visual`) and the same in the Python API. No UI work.
  - **Release:** the user pushes and tags it there.
- **F2 (app):** pin the new dji-thermal-cli.
  - **Building:** a conversion builds the visual mosaic beside its thermal mosaics, when the dataset has visual
    frames.
  - **Showing:** the viewer gains a Visual tab, as RGB tiles under the basemap switch; the frame page and source frames
    window show each frame's visual pair.
  - **Tests:** pytest for the tiles and pairing; Vitest for the tab and the pairs; a live check on a dataset with
    both.
- **F3 (app):** compare visual and thermal.
  - **Panes:** on the compare page, either pane can show a conversion's visual mosaic, beside a thermal one.
  - **Overlay:** a swipe or opacity overlay of the two on one map, with measurements and findings drawn over both.
  - **Frames:** a frame and its pair side by side on the frame page.

### Open decisions (to ask when planning)

- **Order (decided 2026-10-28):** after D2 and its release.
- **Test data (decided 2026-10-28):** the user provides a folder with a flight that has both `_T` and `_V` images,
  before F1 is built. Its path is noted for this machine, as dataset 6 was. **Provided 2026-10-28:** `ignored/m4t-rgb`,
  the 327 `_V` images (M4T wide camera, 4032×3024, 1.5 GB) of the flight whose 327 `_T` frames are dataset 1. Each
  `_V` image has the same pose fields as its `_T` frame in its XMP: GPS, relative altitude, gimbal and flight yaw,
  pitch and the rangefinder's distance. Its EXIF gives a focal length of 6.72 mm, 24 mm as 35 mm equivalent; there is
  no `DewarpData` or `CalibratedFocalLength`.
- **Pairing (found 2026-10-28):** pair `_V` with `_T` by the capture index (`_0024_`), not by the whole name. In 52 of
  the 327 pairs, the two names' timestamps differ by a second (`DJI_20261022163317_0024_T.JPG` and
  `DJI_20261022163316_0024_V.JPG`). By index all 327 pair up.
- **Cameras (decided 2026-10-27):** any DJI wide visual frame (`_V` or `_W`) with a pose and a 35 mm-equivalent
  focal length in its EXIF, paired with its thermal frame; zoom (`_Z`) frames are left out. Tested on the M4T only.
- **Resolution (decided 2026-10-27):** the visual frames' own (on dataset 1's flight about 0.57 cm/px against the
  thermal 1.6 cm/px, the wide camera seeing about 2.3× wider: roughly 6000×6500 px), with an option to make it
  coarser.
- **Registration (decided 2026-10-27):** the thermal mosaic's placement: each visual frame takes its thermal frame's
  refined shift and rotation and the estimated heights, so the two line up by construction; the one constant offset
  between the two cameras is measured, applied and reported. A visual mosaic is built only with the thermal one.
- **Overlay in F3 (decided 2026-10-28):** side by side, a swipe and an opacity blend; see "F3: decisions".

### F3: decisions (2026-10-28)

- **Panes:** the compare page's mosaic menu lists each conversion's visual mosaic ("· Visual") beside its thermal
  tabs. A visual pane is drawn as the viewer's Visual tab: no palette, its readout the conversion's temperature under
  the cursor, findings drawn over it, and its source frames window opening on the Visual camera. "Difference" is not
  offered while either pane is visual.
- **Overlay:** each pane's Show menu gains "Overlay (A over B)": A's mosaic drawn over B's on one map, with an opacity
  slider and a swipe line dragged across it (both kept in the URL). It works for thermal over visual and for two
  thermal mosaics; the readout gives both values.
- **Frames:** the frame page's switch becomes Thermal / Visual / Both. Both shows the visual pair in a second pane
  beside the thermal frame, the two moving together, with the shapes and the cursor drawn on both; with the
  parameters changed, that pane comes third.

### F2: decisions (2026-10-27)

- **Building:** the convert form shows a "Visual mosaic" checkbox when the dataset has visual frames, on by default.
  The conversion's mosaic job passes `MosaicOptions(visual=True)` to its one `make_mosaic` call; the result is kept in
  `mosaics/visual/` and recorded as `mosaics.visual` (beside the kinds, which the baselines and reports loop over;
  with the cameras' offset from its report). A conversion
  that strips the location keeps a located copy for the map only, as the thermal mosaics do.
- **Resolution:** full, the frames' own (0.6 cm/px and about 86 MB on dataset 1's flight). The map reads a copy
  with overviews, so zoomed-out tiles stay fast.
- **Viewer:** a Visual tab, as RGB tiles (PNG with alpha) from a new endpoint. The readout gives the thermal
  temperature under the cursor; findings and measurement shapes are drawn over it, the measuring tools stay on the
  thermal tabs, and a click opens the source frames window.
- **Frames:** on the frame page and in the source frames window, a Thermal/Visual switch shows a frame's visual
  pair in its place, with the same spot or area marked; ← and → work on both. F3 adds the side by side. As built, a
  shape drawn on the visual pair on the frame page is measured on the thermal frame (the drawing maps it back), so
  the frame page's measuring tools stay on with the switch.
- **Downloads:** the visual mosaic, its sidecar and its preview, like the thermal files.
- **Elsewhere:** the Files tab and the reports call the visual images "visual", not "not thermal".
- **Test data:** dataset 1 gets the 327 `_V` images of its flight (`ignored/m4t-rgb`, 1.5 GB) for good, and is the
  paired flight for this and later checks.
- **Pin:** built once dji-thermal-cli 1.6.0 is on PyPI.

## Running

Requested 2026-10-28 (`new.md`):
- Change the default port to 8080.
- A wrapper shell script, `dji-thermal-ui.sh`, that builds, rebuilds, starts and stops the app, from an existing or a
  fresh environment: `dji-thermal-ui.sh start` serves on 8080 with no `--port`; `build` sets up the environment and
  always rebuilds and updates it; `rebuild` is the same as `build`; `start` runs `build` first when there is no
  environment yet.

### What it builds on

- `cli.py`: `--port` (default 8765), `--data-dir`, `--no-browser`, and the "port in use" check.
- The development setup in the README: `uv sync`, `npm ci && npm run build`, `uv run dji-thermal-ui`.
- The port appears in `cli.py`, the README, CLAUDE.md and the Tooling notes above; `tests/test_cli.py` and
  `scripts/smoke.py` pick their own ports.

- **Built** (2026-10-28): see Done.

### G1: proposed

- **Port:** `--port` defaults to 8080 in `cli.py`, and in the README and CLAUDE.md.
- **Script:** `dji-thermal-ui.sh` at the repo root (bash; Linux, WSL and macOS), committed, not in the wheel or sdist.
  - `build` (and `rebuild`): checks `uv` and `npm` are there (it says how to get them rather than installing them),
    then `uv sync`, `npm ci` and `npm run build`.
  - `start`: runs `build` when there is no `.venv`, `node_modules` or `static/dist`, then starts the server.
  - `stop`: stops the server `start` started.
- **Tests:** a pytest that runs the script's `build`-free paths (start, status, stop) against a temporary data folder
  and port; a live run from a fresh clone.

### G1: decisions (2026-10-28)

- **Start:** in the background, with a PID file and a log (`.run/` in the clone, ignored by git), so `stop` stops it;
  `status`, `logs` and `restart` come with it. Options after `start` go to the command (`--no-browser`, `--port`,
  `--data-dir`); the browser opens as it does now.
- **Update:** `build` reinstalls the dependencies from the lock files (`uv sync --locked`, `npm ci`) and rebuilds the
  pages. It does not pull: the code checked out is left alone.
- **Missing tools:** when `uv` is missing, `build` installs it for the user with uv's own installer, pinned to the
  version CI uses, into `~/.local/bin` (without editing the shell's startup files). Node.js and npm are not installed:
  it says where to get them and stops.

## Viewer

Requested 2026-10-28 (`new.md`):
- Deselect when the user presses Esc or clicks the same selected image tile again.
- Remove the temperature range/scale at the bottom of the image: the one in the right panel makes it moot.
- Source frame view: instead of random colours for the tiles, show the orthomosaic under them, with distinct lines
  between them so the tile boundaries are clear. The colour view isn't helpful.
- Rename the "As converted" tab "Mosaic".
- Move "Under the cursor" above "Source frames", renamed "Pointer info".

### What it builds on

- **Selecting:** a click with no tool on pins the readout (`readout(at, true)`), outlines the frame there from
  `mosaics/footprint`, and on the Source frame and Visual tabs opens the source frames window; "Follow the cursor"
  (`follow()`) lets go of it.
- **The map's scale:** `addLegend` in `map/map.ts`, filled with `ScaleView` on the viewer and the frame page; the
  panel's `Controls` has the same scale. The PNG export draws its own.
- **Source frame tab:** the frame index coloured with `frame_colors` (`colourStyle`'s `index`). The data tiles have
  a gutter, so a shader can read the neighbouring pixels (as the sharpening does): seams can be drawn where the
  index changes, exact at every zoom, over the as converted mosaic.
- **Labels:** `TAB_LABELS` (viewer, compare menu, reports) and `TARGET_LABELS` (measurements); the frame page's
  "As converted" is the frame's, not the mosaic's.

- **Built** (2026-10-28): see Done.

### H1: decisions (2026-10-28)

- **Letting go:** Esc, or a click on the frame already selected, unpins the readout and removes the outline (as
  "Follow the cursor" does). The source frames window stays open. Esc goes to a tool being drawn with, or to the
  window when it has the focus, first.
- **Map scale:** off the viewer's and the frame page's maps, whose panels show it. The compare page keeps its maps'
  scales; the PNG exports and the reports keep theirs.
- **Source frame tab:** the as converted mosaic in the temperature tabs' palette and range, with a line drawn
  where the source frame changes; the cursor and a click still name and outline the frame.
- **Labels:** "As converted" is "Mosaic" wherever it names the mosaic: the viewer's tab, the compare page's menu,
  the reports and the measurements' target. The frame page's "As converted" (the frame's) stays.
- **Panel:** "Under the cursor" becomes "Pointer info", above "Source frames", on the viewer (and on the frame page,
  for the same name).

## Naming and the explorer

Requested 2026-10-28 (`new.md`):
- Rename Conversion to Dataset, as that is its core concept ("I'm open to suggestions, but Conversion is not an
  intuitive UI term").
- Navigation: Mosaics becomes an expandable menu listing the mosaics of the conversion unfolded, each opening on the
  right. Compare gets two items, Converted and Not Converted: choosing one shows a list or thumbnails of those images
  to the right, the first one selected and shown whole in the far right pane; an "explorer" kind of UI.

### What it builds on

- **Names:** the UI has Project › Dataset (the R-JPEGs uploaded or used in place, analyzed) › Conversion (the
  temperature images made with one set of settings, and their mosaics). "Dataset" is taken: renaming Conversion to it
  needs the dataset another name. The models, URLs and API say `dataset` and `conversion`.
- **The pane:** `components/nav-pane.tsx`, its items from `conversionPages()` in `core/navigation.ts` (Mosaics,
  Frames, Compare, Report).
- **Mosaics:** the viewer's tabs (Mosaic, Harmonized, Source frame, View angle, Visual), each a `?tab=` link.
- **Compare today:** two mosaics side by side, their difference, or one over the other (`compare/`).
- **Images:** the dataset's thumbnails (`datasets/<id>/thumbnail`), a conversion's files and what it skipped
  (`thermal_conversion`: `converted`, `skipped`), and the frame page's colouring of a converted frame.
- **What "not converted" turned out to be:** dataset 1's conversion 1 converted all 327 thermal frames and skipped
  none; its mosaic placed 151 and left out 176 as oblique (`kinds.*.oblique`, and `unusable`). The frames the user
  means are those left out of the mosaic, which are converted all the same.

### Decisions (2026-10-28)

- **Names:** Project › Flight › Dataset: the R-JPEGs uploaded or used in place are a Flight, a conversion (its
  settings, temperature images and mosaics) is a Dataset. Only what is seen changes (labels, titles, messages,
  reports, export file names): the URLs, the API, the database and the code keep `dataset` and `conversion`, so links
  and saved views keep working. Names already saved (such as "Conversion 1") stay as they are; new ones are named
  "Dataset N".
- **The pane, under each dataset (conversion):** Tools first (Compare, the mosaics side by side as now, and Report),
  then Mosaics (unfolding to each mosaic, the viewer's tabs), then Frames (unfolding to Mosaic and Oblique).
  Compare and the reports are tools; mosaics and frames are the two ways of analyzing the images. The oblique frames
  matter: their angles show defects a nadir view misses.
- **Frames lists:** "Mosaic" (the frames the mosaic placed) and "Oblique" (those it left out for their angle,
  and the few left out as unusable, marked why), with their counts.
- **The explorer:** choosing a list shows its frames to the right of the pane, as a list or as thumbnails (a switch,
  remembered), in capture order, the first selected; the selected frame is shown on the far right as the frame page
  shows it today (palette, range, Pointer info, measuring, Thermal/Visual/Both), and ← → step through the list. The
  list replaces the frame page's own frame picker.

## Files filters

Requested 2026-10-28 (`new.md`), for the Files tab and the other tabs under a project:
- **Kind:** a dropdown with a checkbox for each kind present, and All, which is the default. Choosing any other kind
  unchecks All, and checking All checks every kind.
- **Filters:** replace "Filter by name" with filters on any column. By default there are none, so every file shows.
  Examples: Height <= 20.0, Kind = Thermal, Min > 32.0, Emissivity > 90.
- **Columns:** add Thermal frames and With problems as columns that can be filtered.
- **The buttons:** All files, Thermal frames and With problems fill in the filter they stand for, as if the user had
  set it. They are starting points for the user's own filter.
- **Favourites:** the current filter is saved under a name. Choosing one from a dropdown replaces the current filter.
  A favourite can be deleted but never overwritten: to change one, save a new one and delete the old.

### What it builds on

- **The Files tab:** `FilesTab` in `dataset/tabs.tsx`, with its rows from `fileRows()` in `dataset/files.ts`.
  - The view is `FilesView {show, filter, sort, desc}`, held by `dataset-page.tsx`, and not kept in the URL.
  - The columns are `FILE_COLUMNS`: File, Kind, Captured, Height, Pitch, Min, Max, Mean, Distance and Emissivity.
  - Kinds: `fileKind()` and `kindLabel()` in `core/format.ts` (Thermal, Visual, Not thermal, Not a JPEG, Damaged,
    Unreadable, Unsupported camera).
- **"With problems" today:** a file named by a problem, a file whose kind is neither thermal nor not thermal, or a file
  with warnings.
- **The Problems tab:** a problem's file opens the Files tab filtered to its name (`showFile`).
- **Saved settings:** `Preferences` (one row, server-side, `api/preferences`) holds the defaults and the last report
  author. Per-browser switches use localStorage (the thumbnails).
- The project page has no tabs. "The other tabs" are the flight page's: Problems, WebODM plan and Convert. Only the
  Files tab has a table of rows to filter.

### Proposed design

- **A filter is a list of conditions:** a column, an operator and a value.
  - Numbers (Height, Pitch, Min, Max, Mean, Distance, Emissivity): =, ≠, <, ≤, >, ≥.
  - Text (File, Captured): contains, does not contain.
  - Kind: is one of (the checkboxes).
  - Thermal frame and With problems: yes or no.
  - Values are compared as the table shows them: temperatures in the unit shown, emissivity as 0.90. A file
    without the value does not match a condition on it.
- **The bar:** "Add filter" adds a condition row (column, operator, value, ×). "Clear" removes them all, and the count
  of files shown stays.
- **The Kind header** has the dropdown of checkboxes. It is the same condition as "Kind is one of", so the two stay
  in step. With All checked there is no Kind condition.
- **The buttons** set the filter: All files sets none, Thermal frames sets "Thermal frame is yes", and With problems
  sets "With problems is yes". A button shows as chosen while the filter is exactly its own.
- **The Problems tab's file links** set "File contains <name>".
- **The filter is kept in the URL** (`?filter=`), as the viewer keeps its view, so a reload or a link keeps it.

### Decisions (2026-10-28)

- **Combining:** a file shows only when it matches every condition (no any/all switch, no groups).
- **Columns:** Thermal frame and With problems are visible columns (a check mark), sorted and filtered like the rest.
- **Favourites:** shared by all flights, saved server-side in `Preferences` (`file_filters`).
- **Scope:** the Files tab only; no other table gets the filters.

## Backup and restore

Requested 2026-10-28 (`new.md`): back up and restore projects. A project is exported whole or with only some of its
flights (all by default), preferably as a tarball. Importing must handle collisions at the project level: a project
name already in use is never reused.

### What it builds on

- **A project's rows:** `Project` › `ThermalDataset` (flight) › `ThermalConversion` (dataset) › `ThermalMeasurement`,
  and `Finding` on the flight (its `conversion` is optional). The flight and conversion `report` fields, the analysis,
  results and mosaics are JSON on the rows.
- **Its files:** `datasets/<id>/images/` (uploaded images; a folder flight reads them in place from `folder`), and
  `datasets/<id>/conversions/<id>/` (TIFFs and mosaics). Thumbnails are made on request, not stored. Flight 1 here is
  1.8 GB of images and 0.5 GB of conversion outputs.
- **Paths in the JSON:** frames are named relative to the images folder, and the outputs relative to the conversion
  folder, so they survive new ids (confirmed in K1 on flight 1: no absolute path in its rows).
- **Preferences** are app-wide (defaults, report author, favourite filters), not a project's.
- **Jobs:** an analysis, conversion or mosaic still running has a `run_id` and a status that would be wrong elsewhere.

### Proposed design

- **The archive:** `<project>.tar` with `manifest.json` (the format version, the app version, the project, and its
  flights, conversions, measurements and findings, with their old ids) and the files under `datasets/<old id>/`.
  It is streamed to the browser as it is written, so no copy is made in the data folder.
- **Export:** an "Export" button on the project page opens a dialog with a checkbox per flight (all checked), the
  size each adds, and what to include. A flight still being analyzed or converted is not offered until it finishes.
- **Import:** "Import project" on the projects page takes an archive. It is read and checked first (the manifest's
  version, the paths staying inside the archive), then becomes a **new project** with new ids, the rows remapped.
  A project of the same name gets a new name (see the decisions). Running statuses come in as canceled.
- **Proposed phases:**
  1. **K1: export**: the archive format, the streamed export, and the dialog.
  2. **K2: import**: reading and checking an archive, the new project, collisions, and a round-trip test. Built:
     see Done.

### Decisions (2026-10-28)

- **Contents:** everything: the rows, the images and the conversions' outputs, so a restore is ready to use at once.
- **Folder flights:** their images are copied into the archive, and they come back as uploaded flights.
- **A name in use:** the import dialog says so and proposes a free name ("Roof (2)"), which the user can change.
  The import waits until the name is free.
- **Format:** a plain `.tar`, not compressed.

### What K2 starts from (K1's archive)

- `manifest.json` comes first: `format` "dji-thermal-ui project", `version` 1, `app`, `exported_at`, `project` (its
  row), and `flights`, each its row with `conversions` (each with its `measurements`) and `findings`. A row is every
  stored field by its column name (`project_id`, `dataset_id`, `conversion_id` hold the old ids), dates as ISO text.
- Files follow as `datasets/<old flight id>/images/<path in the analysis>` and
  `datasets/<old flight id>/conversions/<old id>/<path>` (the `viewer/` copies too). A folder flight's row still says
  `source` "folder" with its `folder`: K2 makes it an uploaded flight.

## Storage

Requested 2026-10-28 (`new.md`):
- Add System Settings under User Preferences, with a subitem Storage. The Storage Management page displays where
  project data is stored and offers to move it to another folder. If the new folder contains projects, the UI
  offers to import them, from a list with all of them selected by default. The projects of the current folder are
  migrated to the new one. It uses the backup and restore (K1 export, K2 import) as a dependency.
- The page always reports the current size on disk, with a per-project breakdown.

### What it builds on

- **The data folder** (`datadir.py`): `--data-dir`, else `DJI_THERMAL_UI_DATA_DIR`, else platformdirs' user data
  folder. It holds `db.sqlite3` (WAL: `-wal` and `-shm` beside it), `secret_key`, `datasets/<id>/` and, during an
  import, `imports/`. Django reads it once, at start (`settings.DATA_DIR`): the database cannot change under a
  running server.
- **Sizes:** each flight's and dataset's `size` (`update_size`), summed per project on the projects page. A folder
  flight's images are read in place and are not in the data folder.
- **Backup and restore:** `backup.py` writes a project's archive (manifest, then its files) from this database;
  `restore.py` makes one into a new project here (new ids, folder flights made uploaded, links remapped).
- **The pane:** User Preferences is one item at the bottom (`nav-pane.tsx`); pages under it would be a new group.

### Proposed phases

- **L1: the Storage page** (`/settings/storage`): the data folder's path; its size on disk measured when the page
  opens (the database, the flights' files per project, then anything else), each project with its flights and
  datasets; folder flights' images listed apart as "read in place, not in the data folder". Read only.
- **L2: moving the data folder:** a folder typed in (the browser cannot pick a folder on the server's disk), checked
  first (writable, enough room, empty or a data folder of this app), then moved while no job runs. The app
  remembers the new folder in a small file in its configuration folder (platformdirs' user config folder), read at
  start after `--data-dir` and the environment variable (which still win). The server restarts itself on the same
  port and the page reloads. A data folder there: its projects listed, all selected, the chosen ones imported with
  restore (exported from its database with backup, unpacked here).

### Decisions (2026-10-28)

- **The pane:** System Settings is its own item below User Preferences, unfolding to Storage.
- **The current projects:** their files are moved as they are (the database, the secret key and the flights'
  files: same ids and links, folder flights still read in place). Backup and restore import the new folder's
  projects.
- **What the new folder held:** once its chosen projects are imported, its old database and files are set aside in a
  subfolder there (`replaced-<date>/`), nothing deleted; the page says so.

## Preferred palette

Requested 2026-10-29: a preferred thermal palette, chosen under User Preferences, that the map pages start with
everywhere; the palette can still be switched on each page as now.

**Builds on:**
- **Server:** `default_palette()` in `api.py` already picks each conversion's starting palette for the viewer, the
  frame explorer, the compare page and the mosaic report: the conversion's own palette, else the flight's (as its
  images hold it), else ironbow.
- **Preferences:** the unit, theme and locale are saved the same way, in `Preferences.data`
  (`save_preference`, `PreferencesView`).
- **Palettes:** DJI's ten palettes are read from each flight's images (`dji_<name>`), and are present only where the
  flight has them. The app also has twelve colour maps of its own (ironbow, gray, magma...).

### I1: the preferred palette

- **Built** (2026-10-29): see Done.
- **Preference:**
  - A "Palette" select on the preferences page, saved as `palette` in `Preferences.data`.
  - The select offers "As each flight's images" (the default, which keeps today's behaviour), DJI's ten palettes
    and the app's colour maps.
  - The PUT validates the value against that list.
- **Server:** `default_palette()` starts from the preference. A DJI palette the conversion lacks falls back to
  today's rule.
- **Not changed:**
  - A palette in the URL (a reload or a copied link) still wins.
  - The view-angle tab keeps viridis, since it shows angles, not temperatures.
  - The Convert tab's palette setting still sets the palette of the converted images, not the view.
- **Decisions (2026-10-29):**
  - **The preference wins** over the conversion's and the flight's own palette wherever that palette exists. The
    images' palette is used only for "As each flight's images", or when a flight lacks the DJI palette chosen.
  - **Temperatures only:** the compare page's difference keeps its own diverging palettes, starting with rdbu_r.
- **Tests:**
  - pytest: the PUT saves the palette and refuses unknown ones. `default_palette()` follows the preference, falls
    back for a missing DJI palette, and keeps today's rule for "As each flight's images".
  - Vitest: the preferences page offers the palette and saves it.
  - Live check on 8081: the viewer, the frame explorer and the compare page open with the preferred palette; a
    link's palette still wins; the preference is put back afterwards.

### I2: a preview of the preferred palette

Requested 2026-10-29: a small thermal image under User Preferences that shows the chosen palette.

- **Built** (2026-10-29): see Done.

- **Builds on:** I1's select (`#pref-palette`), `colourValues()` in `map/colour.ts` (colours float values on a canvas
  without a map, as the mosaic report does), and the palettes' colour maps (`viewer_palettes()`; DJI's are read from
  a flight's images).
- **Proposed:**
  - The preferences GET also returns each palette's colour map (DJI's from the most recent flight that has them);
    the page makes the scene's values itself.
  - Beside the select, a small canvas (about 240 × 180) redrawn as the select changes, with a scale bar under it.
  - "As each flight's images": the image in the palette of the most recent flight's images (DJI's, else ironbow),
    captioned so.
  - A DJI palette no flight carries yet: a note in place of the image.
- **Decision (2026-10-29):** **a made-up scene** the app draws itself (a warm roof with a few hot spots on a cool
  background), the same every time and shown with no flights. Only DJI's palettes need a flight that carries them.

## Preferred basemap

Requested 2026-10-29: a user preference for the default map provider.

**Builds on:**
- **Server:** `BASEMAPS` in `settings.py` (ESRI Satellite, the default, and OpenStreetMap) and Mapbox Satellite,
  added by `page_basemaps()` in `analyzer/basemaps.py` once a token is known (B3). Each entry's `default` says which
  one a map starts with. The preferences are saved through `PUT /api/preferences`, as I1's `palette` is.
- **Front end:** `addBasemaps()` in `map/basemaps.ts` shows the `default` basemap on every map (the viewer, the
  compare page, the project maps, the location picker and the dataset report). If Mapbox's tiles are refused, it
  goes back to the basemap shown before. The preferences page (`preferences/preferences-page.tsx`) has I1's
  "Palette" select to follow.

### N1: the preferred basemap

- **Built** (2026-10-29): see Done.
- **Decisions (2026-10-29):**
  - **Where it is chosen:** only on the preferences page, like the palette. Switching the basemap on a map
    changes that map only.
  - **Order:** before M, since it is small.
- **Preference:**
  - A "Map" select on the preferences page ("The maps start with"), saved as `basemap` in `Preferences.data`.
  - It offers ESRI Satellite (the default, which keeps today's behaviour), OpenStreetMap, Mapbox Satellite and
    None. Mapbox Satellite is listed only when a token is known. Without one, the page says the token is added
    from a map's basemap switch.
  - Each basemap gets a `key` (`esri`, `osm`, `mapbox`), and the PUT checks the value against them and `none`.
- **Server:** `page_basemaps()` marks the preferred basemap as the `default`. If Mapbox is preferred and no token
  is known any more, Esri stays the default.
- **Front end:**
  - `addBasemaps()` already starts with the `default`. If the preferred Mapbox is refused (a wrong or expired
    token), the map goes to the settings' own default (Esri), not to None.
  - None is honoured: a map starts with no basemap.
- **Tests:**
  - pytest:
    - The preference is saved, and a value that isn't a basemap is refused.
    - The pages' basemaps mark the preferred one as the default.
    - A preferred Mapbox without a token falls back to Esri.
  - Vitest:
    - The preferences page offers the basemaps and saves the choice, and lists Mapbox only with a token.
    - A map starts on the preferred basemap, and a refused Mapbox goes to Esri.
  - Live check: the viewer, compare page and a project map open on OpenStreetMap, then on Mapbox with the token
    from `.env` (never printed), light and dark. The preference is put back afterwards.
- **Docs:** the README's preferences and basemaps sections, and a CHANGELOG entry under Unreleased.

## Exports

Requested 2026-10-29 (`new.md`):
- **Formats:** export frames, mosaics and images in several formats, for one frame as well as a whole flight:
  Raw, PNG, TIFF and DJI's radiometric JPEG (R-JPEG). Today only a PNG of the view can be exported.
- **Private options**, such as "Raw (Private)" and "TIFF (Private)", that remove the GPS and personal information
  (an email address, the location...) from the files.
- **What each format is for:**
  - PNG: a compressed RGB image, to look at only.
  - Raw: the source files as they are.
  - Private: a radiometric file without the GPS or personal information.
  - R-JPEG: DJI's own radiometric JPEG. dji-thermal-cli and its SDK port may need changes for it.

### What it builds on

- **Today's exports:**
  - The "PNG" button on the viewer, the frame explorer and the compare page (`saveCanvas` in `viewer/canvas.ts`)
    saves the view as shown, with its scale and caption.
  - A dataset's outputs download as a zip, or one at a time (`ConversionDownloadView`). These are dji-thermal-cli's
    per-frame TIFFs and PNGs, and the mosaics' TIFFs and preview PNGs.
  - A project exports whole as a `.tar` (K1).
- **dji-thermal-cli 1.7.0** (the app pins 1.6.1):
  - Products `temp_c/f/k` (float32 TIFF or EXR), `temp_ck`, `temp_dc`, `raw` and `gray16` (uint16 TIFF or PNG),
    and `pseudo` (an RGB PNG or TIFF).
  - `--strip-location` (`privacy.py`) removes from every output's metadata the EXIF GPS IFD, the serial numbers,
    the owner name and the image ID, and from the XMP the GPS, DJI's position, altitude, RTK and rangefinder-target
    fields, the serial numbers and `SelfData`. The capture time is kept. A mosaic is then written without its
    georeference.
  - It never writes an R-JPEG: DJI's measurement parameters live in binary APP4 blocks fixed at capture. The SDK
    port only changes them in memory (`set_measurement_params`), and the block's layout differs between cameras.
- **The source files:** a flight's R-JPEGs in `datasets/<id>/images/` or read in place from its folder, and the
  visual `_V` JPEGs beside them where the drone took them.

### Proposed phases

1. **M1: in dji-thermal-cli** (a release, then pinned here):
   - A location-free copy of an R-JPEG that stays radiometric: the same removals as `--strip-location`, made in
     the JPEG's EXIF and XMP. DJI's APP blocks are kept, after checking they hold no position or serial number.
     The SDK port must measure the copy exactly as it measures the source.
   - The free-text fields added to what Private removes (see the decisions), in `--strip-location` too.
   - An `rjpeg` output: the source with the measurement parameters written into its header, for each camera family
     the port reads, checked against the native SDK.
2. **M2: the exports on the server:** one endpoint for a frame, the frames chosen, or a whole flight, in a format:
   Original, Original Private, TIFF, TIFF (Private), PNG, R-JPEG and R-JPEG (Private); and for a dataset's
   mosaics: TIFF, TIFF (Private) and PNG. The Convert tab offers R-JPEG among its outputs. Several files come as a
   zip, streamed as it is made (as the conversion's zip is today). The view's adjustments (palette, range, tone
   curve, sharpening) are made in the browser today (`map/colour.ts`): the server needs the same colouring in
   Python for the PNGs and the R-JPEGs' pictures it makes, checked against the browser's on the same values.
3. **M3: the export dialog:** on the frame explorer (this frame), on the flight's Files tab (the frames chosen, or
   all of them), and on the viewer (the mosaic). Each format is described by what it is for. The current "PNG"
   button stays as the export of the view as shown.

### Decisions (2026-10-29)

- **Original** (named so, not Raw: 2026-10-29) is each source file exactly as it is, unconverted. Its menu item
  names the file's own format: "Original (R-JPG)", or "Original (TIFF)" for a camera that writes radiometric TIFFs.
  "Original (R-JPG, Private)" is the same file with the private information removed, still radiometric. Choosing
  R-JPEG instead is choosing to write new R-JPEGs.
- **R-JPEG output** is added to the converter and to the exports, if it is not a huge lift: the source R-JPEG with
  a dataset's measurement parameters (emissivity, distance, humidity, reflected and ambient temperature) written
  into DJI's header, so DJI's tools measure with them.
  - **The lift** (looked at on 2026-10-29): each camera family the SDK port reads (girp, dirp, iirp, hirp) reads its
    parameters at fixed offsets in its APP blocks, so writing them is the reverse, per family. A written copy can
    be checked with the native SDK in dji-thermal-cli's `native` tests: it reads the parameters back and measures
    the copy as the port does.
  - **Limits:** a family that stores no parameters, or one with no sample image to check against, is skipped with
    the reason. Normalizing and value replacement are not carried in an R-JPEG: only the parameters are.
  - **Frames only:** a mosaic is not an R-JPEG (it has no sensor counts or camera calibration). Its exports are
    TIFF, TIFF (Private) and PNG.
  - **Its picture** (2026-10-29): the R-JPEG's visible JPEG is redrawn with the view's palette, range and
    adjustments (brightness, contrast, gamma, sharpening), so photo viewers show the adjusted view; DJI's
    original picture can be kept instead, as an option. DJI's tools colour it from the counts as always.
- **A format that cannot carry what is asked** (2026-10-29): when the export would include normalizing or replaced
  values and the format cannot hold them (R-JPEG, Original), the dialog says so and points to the formats that do
  (TIFF).
- **TIFF and PNG of frames** are made when exported, from the source, with a dataset's settings chosen in the
  dialog or the flight's own embedded values. A flight need not be converted first.
- **Private** removes dji-thermal-cli's list, and also the free-text fields where a name or an email address could
  be: EXIF Artist, Copyright, UserComment, ImageDescription and the XP fields, and their XMP counterparts
  (dc:creator, dc:rights, dc:description...). The capture time is kept.
- **PNG of several frames:** one temperature range shared by all of them (the flight's, changeable in the dialog),
  so a colour means the same temperature in every frame.

### M1: R-JPEG copies in dji-thermal-cli (planned 2026-10-29)

Looked at on the SDK's samples (H20N, H20T, H30T, M2EA, M30T, M3T, M3TD, M4T, XT S) before planning:

- **Where identifiers are, besides what `--strip-location` removes:** the EXIF free-text fields (ImageDescription,
  XPComment, XPKeywords...); the sensor's serial (`sensor_id`) in DJI's `DJI-DBG` block (APP7) on the newer
  cameras, inside the EXIF block on the H20N, H20T and M2EA, and repeated in some `PADDING` blocks; the thermal
  module's serial in the M3TD's `HIDR` calibration block (APP5). The MPF preview image (a second JPEG after the
  first) has no EXIF of its own.
- **Where each family reads its parameters:** girp (some M30T firmware) in APP4's AA 55 line (emissivity %, humidity %,
  distance in 0.1 m, reflection in 0.1 °C; ambient is fixed); iirp (most cameras) as five floats at APP4's start
  (ambient, distance, emissivity, humidity 0-1, reflection); hirp (newer M3TD and M4T firmware) in APP4's
  TempParams (Q13/Q16 values, with flags saying whether reflection and ambient are the file's own). **dirp (H20T,
  XT S) reads none:** DJI's SDK starts it from fixed defaults, so its R-JPEGs cannot carry parameters.

The design (dji-thermal-cli 1.8.0, `rjpeg.py` and its API):
- **Every edit in place, the file's length and layout unchanged** (the SDK reads some tables past their segment's
  end, and the MPF index points into the file by offset): values are zeroed, an XMP packet keeps its length with
  padding.
- **A private copy** (`private=True`): `--strip-location`'s removals, the free-text fields (EXIF Artist, Copyright,
  ImageDescription, UserComment, the XP fields; XMP dc:creator, dc:rights, dc:description, dc:title and
  dc:subject), and every occurrence of the sensor's and module's serials anywhere in the file. The free-text fields
  are added to `--strip-location` too. The capture time is kept.
- **A copy with parameters** (`params=`): the dataset's emissivity, distance, humidity, reflected and ambient
  temperature written where the family reads them; a dirp file (or a gain mode that has none) is refused with the
  reason.
- **Its picture:** DJI's own, or one given (an RGB image the size of the frame, from the app's colouring in M2, or
  the CLI's palette): the visible JPEG and the MPF preview are re-encoded and the MPF index rewritten; the APP
  segments are left as they are.
- **The CLI:** an `rjpeg` product in `process`, honouring `--strip-location`, with the picture coloured with the
  palette asked for (`--rjpeg-picture original` keeps DJI's).
- **Tests:** for every sample, the copy measures exactly as the source measured with the same parameters set, in
  the port and in the native SDK (`native` tests); a private copy measures as the source, and none of the
  identifiers found in the source is left in it; the length and the MPF index are checked.
- **Release:** 1.8.0 on a `release/1.8.0` branch; the user publishes it, then M2 pins it here.
- **Done:** see Done below.

### M2: the exports on the server (planned 2026-10-29)

dji-thermal-cli 1.8.0 is pinned (its `rjpeg` output kept off the Convert tab until now).

- **Colouring in Python** (`analyzer/colouring.py`): `colour(values, colouring)` makes the RGB image the browser's
  `colourValues` (`map/colour.ts`) makes: the range, the tone curve's shares (as `tone`/`curve_shares` give the
  browser now), the unsharp mask, the isotherm's grey and the palette (DJI's from the frames, or the tiler's).
  - **Matched on the same values:** one fixture (`tests/fixtures/colouring.json`: values with no-data, and a
    colouring per feature) holds the RGB `colourValues` makes. Vitest checks `colourValues` against it, pytest
    checks `colour`; a change to either side fails until the fixture is made again by a script.
- **Frames:** `POST datasets/<id>/exports` with what is asked returns `{url}`, and `GET exports/<id>` streams the
  file (one frame) or a zip (several), so a list of 300 frames is not in a URL and the browser downloads it itself.
  The request is kept in memory for an hour.
  - **Asked:** `format` (original, original_private, tiff, tiff_private, png, rjpeg, rjpeg_private), `frames` (paths,
    or all), `conversion` (whose settings measure them; none: the flight's embedded values), and the view
    (`palette`, `range`, the adjustments `gamma`, `equalize`, `sharpen`, `isotherm`) for PNG and the R-JPEG's picture.
    - **PNG of several frames:** one range for all of them: the one given, else the flight's: the frame page's Auto
      (2nd to 98th percentile) taken over all the frames chosen, measured in a first pass that the frame cache keeps.
    - **R-JPEG picture:** `picture=view|original`.
  - **Formats:**
    - **Original:** the file as it is. Private: `rjpeg.copy(data, private=True)`.
    - **TIFF:** the temperatures in the unit as float32 (dji-thermal-cli's `temp_c`/`temp_f`), Private with
      `strip_location`.
    - **PNG:** the coloured frame, one pixel per sensor pixel, with the location left out (there is none in a PNG
      the app makes).
    - **R-JPEG:** `rjpeg_copy` with the settings, its picture coloured from the view; Private with `strip_location`.
  - **Refused (400, with the reason and the formats that can):** R-JPEG or Original for a normalized conversion or
    one replacing values; R-JPEG with parameters on a camera that stores none (dirp).
  - **Names:** a frame's own stem, `<stem>.jpg` (Original), `<stem>_temp_c.tiff`, `<stem>.png`, `<stem>_rjpeg.jpg`;
    a zip `<flight>-<format>.zip` keeps the frames' folders.
  - **Streamed:** each frame made as the zip reaches it (zipstream-ng), with `Content-Length` left out for made
    files; the same frame cache as the frame page (`measured`).
- **Mosaics:** `GET <conversion>/mosaics/<tab>/export?format=tiff|tiff_private|png&` the view. TIFF: the mosaic's
  GeoTIFF; Private: dji-thermal-cli's copy without georeference, written once and kept. PNG: the coloured mosaic,
  transparent where there is no data.
- **The Convert tab** offers R-JPEG, with its picture (the conversion's palette, or DJI's own).
- **Tests:** pytest on the sample frames for every format and its private form (the private files hold none of the
  frame's identifiers or location, the R-JPEG measures with the settings), refusals, names, a zip of frames, the
  mosaic exports; the colouring fixture in pytest and Vitest. Live: each format from the API on dataset 1, the files
  opened (the R-JPEGs measured by dji-thermal-cli, the PNGs looked at).

**Decisions (M2, 2026-10-29):**
1. **A mosaic's PNG is always at full resolution**, one pixel per mosaic pixel however large. It is written in strips
   (the mosaic read window by window, with the unsharp mask's margin, and the PNG's rows compressed as they come),
   so it is never held whole in memory, and streamed as it is written.
2. **Original of a flight:** the thermal R-JPEGs, and their visual `_V` images when asked (`visual=1`, a checkbox in
   M3's dialog); Private removes the visual images' location and personal information too (dji-thermal-cli's
   `strip_exif` and XMP removals on a plain JPEG).
3. **A frame's PNG is the plain image:** the coloured frame, one pixel per sensor pixel, nothing drawn on it. The
   view's PNG button still saves the view with its scale and caption.

- **Done:** see Done below.

### M3: the export dialog (planned 2026-10-29)

M2's endpoints, behind one dialog shared by three pages. It asks only for what M2 needs (nothing changes on the
server), and downloads what the server makes.

- **One dialog** (`components/export-dialog.tsx`, the request built by pure, tested code in `core/exports.ts`). An
  "Export…" button beside the page's "Export PNG", which stays as the export of the view as shown.
  - **Formats:** radio buttons, each with what it is for (PNG: an image to look at; TIFF: the temperatures, for GIS
    and analysis; R-JPEG: DJI's radiometric JPEG with the dataset's parameters; Original: the source files as they
    are), each with its Private form ("without the location, serial numbers or names"). Original names the files'
    own format: "Original (R-JPG)", or "Original (TIFF)".
  - **What a format can't carry** is said before export: R-JPEG and Original are disabled with the reason, pointing
    to TIFF, for a normalized dataset or replaced values (the server's check stays the last word).
  - **Saving:** POST, then the browser downloads the `url` (an `<a download>`), and the dialog closes; an error
    stays in the dialog.
- **The frame explorer:** this frame, measured as the page measures it, with the view as shown (palette, range,
  adjustments, isotherm) for PNG and the R-JPEG's picture.
- **The Files tab:** an "Export…" in its bar.
  - **Frames:** "The N frames shown" (the thermal rows the filter shows) or "All N frames".
  - **Measured with:** a dataset of the flight (the latest ready one by default) or "The frames' own values" (the
    default when there is none).
  - **PNG and the R-JPEG's picture:** a palette (the preferred one by default) and the range: "Shared, automatic"
    (the server's 2nd to 98th percentile over the frames) or a low and high typed in.
  - **Original:** "With their visual images" when the flight has any.
- **The viewer:** the tab shown: TIFF, TIFF (Private) and PNG, with the view and the correction as the tiles are
  asked; the visual tab exports its own image.
- **Tests:** Vitest for the request built on each page (formats offered, refusals, frames shown or all, the
  settings, the view), the dialog's errors and the download; a live check on dataset 1: each page's export saved
  and opened, then removed.

**Decisions (M3, 2026-10-29):**
1. **The Files tab's frames are those the filter shows**, or all of them: no checkboxes on the rows.
2. **It measures with the latest dataset by default**, else the frames' own values; either can be chosen.
3. **On the frame explorer with parameters changed**, the dialog offers "As converted" or "With the parameters
   changed" (M2's `changes`); only the first when no parameter is changed.

- **Done:** see Done below.

## Search

Requested 2026-10-29 (`new.md`):
- A search/filter box under "Projects" in the navigation pane, filtering the projects listed by a
  case-insensitive "contains" match.
- A search/filter box at the top of User Preferences and System Settings, filtering the options shown the same way.
- Shared code for every search in the app, so that searching is consistent, live and fast everywhere.

### What it builds on

- **Today's searches:** the Projects page ("Search projects") and a project's flights ("Search flights") filter as
  you type with `matchesSearch` in `datasets/list.ts`: case-insensitive, every word of the query in the name, in
  any order. The Files tab has its own text filter (`dataset/tabs.tsx`). The location field searches addresses
  (a geocoder: not a filter, left as it is).
- **The navigation pane** (`components/nav-pane.tsx`) lists projects › flights › datasets with folds kept in
  `localStorage`; **User Preferences** (`preferences/preferences-page.tsx`) and **System Settings**
  (`settings/settings-page.tsx`) are sections of fieldsets.

### Proposed phases

1. **S1: the shared matcher and the pane's filter:** `matchesSearch` moves to `core/search.ts` (one matcher, plus
   a `SearchBox` component: `type="search"`, Escape clears, the count shown, "No … match"), used by the Projects
   and flights pages and the Files tab's text filter. The pane gets the box under Projects, filtering projects by
   name as you type; the folds are left as they are, and the page shown stays marked.
2. **S2: the settings pages' filter:** each option (a fieldset's row) is matched on its label, its help text and
   its section's title; a section with no match is hidden, a section whose title matches shows whole. The same
   box and matcher.

### Decisions (2026-10-29)

- **The match:** every word of the query, in any order and any case, as today's searches (it also finds every exact
  "contains" match), the same everywhere.
- **The pane's filter** looks through the projects' names only. A project hidden by it hides the page shown under it
  too (its mark with it); the page itself is unchanged.
- **Kept:** the pane's filter text is kept from page to page (`localStorage`), as the folds are, until emptied.
- **When:** after M, now done.

## ODM

Requested 2026-10-29, held while a plugin wrapper and the REST API were evaluated; the REST API was chosen, and the
phases ODM1 to ODM3 planned, the same day (below).

**What it does, either way:** create a WebODM task from a conversion's temperature TIFFs with the WebODM plan's
options (`analysis['webodm']`, made by dji-thermal-cli), and follow its progress. The plugin's `thermal_task.py` and
the task panel in `conversions.js` (at LuxODM a2a81052) show what it did.

**The two options:**
- **The REST API:** the app stays standalone and talks to a WebODM node over HTTP. It needs WebODM's address and
  credentials (System Settings, below), and must cope with the node being down, slow or another version.
- **A plugin wrapper:** a thin WebODM plugin that runs the analyzer in WebODM's process, creating tasks through
  WebODM's own models, with no HTTP and no credentials. To evaluate: Django and Python versions against WebODM's,
  its database (PostgreSQL there, SQLite here), its Celery workers against `analyzer/jobs.py`, serving the pages and
  static files inside WebODM's, and keeping the standalone app and the plugin from drifting apart (the plugin is
  what A moved away from).

**System Settings › WebODM** (wanted whatever is chosen for processing, decided 2026-10-29):
- The node's address. Plain `http://` is accepted: people run local and development nodes.
- Its credentials are written to `.env`, as the Mapbox token is (`write_token` and the `.env` reading in
  `analyzer/basemaps.py` to be made general, not copied), and are never kept in the database or the preferences.
- The page shows them masked, never in full, and a value in the environment is shown and changed there, as with
  Mapbox. They are checked with the node (a login) before they are saved.

**Leaning (2026-10-29): the REST API**, if it covers what the app needs: adding and editing projects and tasks, and
keeping the task options applied.

**Evaluation of the REST API** (2026-10-29, from upstream WebODM's `app/api` at 51c8f98b, 2026-10-15; LuxODM's
findings, reports and storage routes are its own and not counted on):
- **Projects:** list (paged, searchable), create (`POST /api/projects/`), `POST .../edit` (name, description, tags,
  permissions), delete, duplicate.
- **Tasks:** create with the images in one request, or `partial: true` then chunked `.../upload` and `.../commit`
  (the way for a few hundred TIFFs); `PATCH` its name, options, processing node and tags; `cancel`, `restart`
  (with `rerun-from`, `can_rerun_from` saying where), `remove`, `duplicate`; `.../output` (the console log); the
  task's status and progress on GET; its assets through `.../download/<asset>` and tiles.
- **Processing nodes:** `/api/processingnodes/` and `/api/processingnodes/options/` (the ODM options the nodes
  offer, for building the options form).
- **Task options kept:** presets are kept on the server per user (`/api/presets/`: name and options, create,
  edit, delete; the system ones read-only). WebODM remembers the last preset used only in its own browser
  (`last_preset_id` in localStorage), and the user profile holds no preferences (`/api/user/profile/`: name and
  quota). So the app keeps its own presets in WebODM, where WebODM's pages see them too, and remembers which it last
  applied in its own preferences.
- **Login:** `POST /api/token-auth/` with a user name and password gives a JWT that lasts 6 hours (refreshable).
  WebODM issues no long-lived token, so `.env` keeps the user name and password, and the server asks for a token
  when it needs one.
- **Not covered:** nothing found for the work above. The plugin route would add only what the REST API can't do,
  so it is not needed for this.

**Decisions (2026-10-29):**
- **The REST API**, not a plugin wrapper.
- **`.env`:** `WEBODM_URL`, `WEBODM_USERNAME` and `WEBODM_PASSWORD`, the user name and password masked on the page.
- **The WebODM permissions the account needs are listed** for the user: on System Settings › WebODM beside the
  fields, and in the README.

**The WebODM permissions the account needs** (from upstream's `app/api`, `app/boot.py` and `app/signals.py`):
- **An ordinary, active account:** not staff, not superuser. Every new account joins WebODM's **Default** group,
  which holds all the model permissions below, so an account made in WebODM's admin needs nothing more, unless they
  were taken away from it or the group.
- **Model permissions** (Django admin › Users or Groups):
  - `app.add_project`: create projects (`POST /api/projects/`). The account then owns them and gets every permission
    on each one (`project_post_save`).
  - `app.add_task`, `app.change_task`, `app.delete_task`: tasks go through `DjangoModelPermissions`, so creating,
    uploading to, committing, cancelling, restarting and removing a task (all POSTs) need `add_task`, a `PATCH`
    `change_task`.
  - `app.add_preset`, `app.change_preset`, `app.delete_preset`: keeping the app's presets.
  - `nodeodm.view_processingnode`.
- **Per project** (object permissions, django-guardian), for a project the account didn't create: `view_project` to
  see it, `change_project` to edit it and add or change its tasks, `delete_project` to remove a task or the
  project. A project shared with the account and not owned is never deleted through the API: it only loses the
  account's permissions on it.
- **Per processing node:** `view_processingnode` **on the node itself** (WebODM's admin › Processing nodes ›
  Object permissions). WebODM gives it to the Default group only for the node there when it first started: a node
  added later must be given to the account or its group, else it is neither listed nor offered with its options
  (`get_objects_for_user(..., accept_global_perms=False)`), and a task sent to it is refused.

**To check against a running WebODM when built:** the chunked upload, the presets' `options` format, and the
permissions above, with an account given only those. The live checks use the user's WebODM on `127.0.0.1:8001`
(decided 2026-10-29), with an account the user gives, holding only those permissions.

**Planned (2026-10-29):**

**ODM1: System Settings › WebODM**
- **The fields:** the address (`http://` accepted), the user name and the password. **Check and save** logs in to
  WebODM (`POST /api/token-auth/`) and only then writes `WEBODM_URL`, `WEBODM_USERNAME` and `WEBODM_PASSWORD` to
  `.env`. **Remove** takes all three out of it.
- **`.env`:** the Mapbox token's reading and writing in `analyzer/basemaps.py` move to one module for both (read a
  name from the environment, else the first `.env` that has it; write names in place of those there, the file kept
  at mode 0600). Mapbox keeps working as it does.
- **Masked:** the password never goes to the browser: the page says only that one is set. The user name is shown
  masked. Values from the environment are shown and changed there, as with Mapbox.
- **The permissions** the account needs (above) are listed beside the fields and in the README.
- **The client** (server side, stdlib `urllib` as `basemaps` and `places` use, no new dependency): asks for a token
  when it needs one, keeps it in memory only, asks again when it expires or is refused; every call has a timeout;
  errors in plain words (the node can't be reached, the login is refused, a permission is missing, another
  version's answer not understood).

**ODM2: Process in WebODM**
- **Where:** "Process in WebODM" in a conversion card's menu opens a panel on the card; it says to set up WebODM in
  System Settings when that isn't done.
- **The checks** carried over from the plugin's `thermal_task.py`: stopping a task (the conversion isn't finished,
  its location was stripped, no `temp_c` TIFFs, fewer than 2 frames); warning (normalization, pitch limit,
  emissivity or humidity off the plan's process command). A name two subfolders share keeps its folders in the
  task's name for it, as there.
- **The project, chosen each time** (decided 2026-10-29): one of the account's WebODM projects (searchable), or a
  new one, named after this app's project unless changed. Nothing is remembered.
- **The options** (decided 2026-10-29): the plan's, the recommended ones ticked and those to consider not, plus
  "Add an option" for any option the processing nodes offer (`/api/processingnodes/options/`), each with an input
  for its type and domain.
- **Presets:** apply one of WebODM's presets (the account's and the system ones) to the ticked options, or save the
  ticked options as a preset of the account's own. The preset last applied is remembered in this app's preferences
  and offered first.
- **The node and name:** a processing node the account can see, or automatic; the task named
  "flight - dataset" unless changed.
- **The upload** is a job on a second worker thread, so a long upload doesn't hold up conversions: the task is made
  with `partial: true`, the TIFFs sent in batches (progress by bytes), then committed. Cancelling it, or a server
  that stops part way, removes the half-made task from WebODM where it can.
- **Following it:** a new table of the tasks made (conversion, WebODM project and task, name, status, progress,
  error). The conversion card lists them, each with its status and a link to it in WebODM. While a page shows one
  being processed, the server asks WebODM for its status, at most every few seconds. Deleting a conversion keeps
  the WebODM task.

**ODM3: ODM's orthophoto back** (decided 2026-10-29; built, see "Done")
- **Decisions:** planned now; only the orthophoto comes back (not ODM's report, DSM or DTM); it is brought back
  with a button, not on its own; it is shown as a viewer tab, and offered on the compare page too.
- **Where:** a completed task's line on the conversion card gets **Bring the orthophoto here**. The download is a job
  on the upload worker (`jobs.UPLOADS`), with its progress on the task's line and a cancel.
- **What is downloaded:** `.../download/orthophoto.tif`, into the conversion's `webodm/` folder. It is kept only as
  temperatures: one band of floats (WebODM's alpha band as its no-data), converted from the TIFFs' °C to the
  conversion's unit, written with overviews as the mosaics are. Anything else (an orthophoto of colours) is refused
  in plain words and not kept.
- **One per conversion:** bringing back another task's orthophoto replaces it; the card says which task the one
  shown came from, and it can be removed there. Deleting the task's line or the conversion removes it; rebuilding
  the conversion's mosaics keeps it.
- **Shown as** a **WebODM** tab on the viewer (a mosaic kind `webodm`, read as temperatures like As converted: the
  palettes, ranges, the scale, points, areas and measurements), and a mosaic to pick on the compare page. The
  viewer opens for a conversion with an orthophoto even without mosaics of its own.
- **To check live:** that the orthophoto WebODM makes from the TIFFs keeps their temperatures (one band of floats).

**The DSM test** (2026-10-29/30, asked by the user: what would WebODM's DSM bring?). Flight m4t-220, its 209 nadir
frames converted with the WebODM plan's settings, processed in WebODM (127.0.0.1:8001, as thermaltest) with `dsm` on
and `fast-orthophoto` off: about 8 minutes. ODM's DSM from the thermal TIFFs alone is good: the house sharp-edged,
its roof planes, lower wing and the trees clear, about 90 % of the flight covered (holes at its edges). The same
mosaic (dji-thermal-cli 1.8.0, `--normalize --mosaic-normalize`), by the surface its frames were placed on:

| Heights | Misalignment (median / p90) | Seams p95 |
|---|---|---|
| The ground plane | 14 / 46 cm | 4.01 °C |
| dji-thermal-cli's own (the default, 96 cm cells) | 2 / 22 cm | 2.38 °C |
| WebODM's DSM, 96 cm cells | 3 / 17 cm | 2.25 °C |
| WebODM's DSM, 24 cm cells (`--mosaic-height-cell 16`) | 2 / 9 cm | 2.26 °C |

At 24 cm cells the roof's hips are straight and its vents no longer step or double at the seams; at 96 cm the
DSM's detail is mostly averaged away and the eaves smear. Past the DSM's edge the frames fall back to the plane.

**CLI2: dji-thermal-cli 1.9.1 reads ODM's DSM** (done 2026-10-30, see "Done"; found by the DSM test; fixed in dji-thermal-cli, branch
`fix-dsm-reading`, then `release/1.9.1`, merged there 2026-10-30): `--mosaic-dsm` imported tifffile, a dev dependency only, so it failed when installed from PyPI;
ODM's `dsm.tif` (Deflate with the floating-point predictor) needed imagecodecs besides; a DSM that couldn't be read
failed as "Normalization failed" after converting every frame, and the option renaming in messages turned a path's
`dsm` folder into `--mosaic-dsm`. 1.9.1 reads TIFFs itself (`tiffin.py`, checked against 816 files GDAL wrote),
checks the DSM before the frames, and leaves paths alone. Then pinned here (from 1.8.0: 1.9.0's DJI SDK option
comes with it, unused).

**ODM4 and ODM5: WebODM's DSM under the mosaics** (planned 2026-10-30)
- **Brought back** from a completed task as the orthophoto is (a button on its line, a job on the upload worker),
  kept in the conversion's `webodm/` folder; one per conversion.
- **Used** by the mosaics: a choice when building them, "Use WebODM's DSM", with a finer height cell
  (`height_cell`) when it is on; the mosaic's report already says "Heights … from the DSM".
- **Asked for:** a task made by the app turns `dsm` on and leaves `fast-orthophoto` off when the DSM is wanted
  (both are offered today, neither forced).
- **Maybe:** the height under the pointer on the viewer, beside the temperature; heights in a measurement.
- **Decisions (2026-10-30):**
  - **All of it:** brought back, used by the mosaics, asked for by tasks, and also the DSM as a layer and the height
    under the pointer (with heights in measurements). Built in two steps: **ODM4** (brought back, used, asked for)
    then **ODM5** (the layer and the heights).
  - **The cell size is a setting:** a field among the mosaics' options, shown when "Use WebODM's DSM" is on,
    defaulting to the DSM test's best (about 24 cm).
  - **A task asks for the DSM by a tick** ("Make a DSM", off by default: it makes the task slower), which turns
    `dsm` on and `fast-orthophoto` off.
- **ODM4's build** (2026-10-30):
  - **Server:** `WebODMTask` gets `dsm_status`, `dsm_progress`, `dsm_error`, and `ThermalConversion` a `dsm`
    (migration 0009). `webodm_tasks` brings back an asset by name (`orthophoto.tif` or `dsm.tif`) with the same job;
    one download per task at a time (they share its `run_id`). The DSM is kept as WebODM wrote it,
    `webodm/dsm-<task>.tif`, once dji-thermal-cli has read it (`mosaic.read_dsm`); the conversion's `dsm` says where,
    the task it came from, `use` (on when brought back) and `height_cell`. Endpoints: `webodm-tasks/<id>/dsm` (POST
    brings it back, DELETE stops it), `conversions/<id>/dsm` (PATCH `{use, height_cell}`, DELETE removes it). A task
    taken off the list takes its DSM with it, as its orthophoto; a restore keeps the DSM, not its task.
  - **Mosaics:** when the conversion's DSM is used, `make_mosaic` gets `dsm` and `height_cell`; the mosaics keep
    which DSM and cell they were built with.
  - **The cell is in mosaic pixels** (dji-thermal-cli's `height_cell`, 8–1024, default 16 with a DSM), shown in
    centimetres too once the mosaics' pixel size is known: the pixel size is only known once they are built.
  - **Pages:** the task panel's "Make a DSM" tick (sends `dsm` true, leaves `fast-orthophoto` out); a completed task
    that asked for it gets "Bring the DSM here"; the conversion's card says the DSM is here, with the tick "Use it
    under the mosaics", the cell, "Build the mosaics again" when they were built otherwise, and Remove.
- **ODM5's decisions (2026-10-30):**
  - **A Heights tab** on the viewer, beside WebODM's: the DSM coloured with the palette and range controls (viridis
    first, as the View angle tab), its legend in metres; not a temperature tab, so no correction, isotherm, Measure
    or Source frames there (as on the View angle tab).
  - **Heights above the lowest ground:** 0 m at the DSM's lowest ground (its 1st percentile, so a stray low pixel
    doesn't set it), a roof reading its own height; the height WebODM gives is in the readout's tooltip.
  - **Measurements** on the temperature tabs: a spot gets the ground's height there, an area its lowest, mean and
    highest height. Not a line's profile, not in the CSV.
- **ODM5's build** (2026-10-30):
  - **Server:** bringing the DSM back also writes the copy the viewer reads (`webodm/dsm-<task>-heights.tif`: heights
    above the lowest ground, tiled, with overviews; `heights_raster`, `base_m` and its `heights` statistics in the
    conversion's `dsm`). The kind `dsm` and the tab `heights` (`thermal_mosaics.HEIGHTS`), kept apart from the
    temperature tabs (`thermal_mosaics.temperatures(tab, band)`). A mosaic point gets `height` (on every tab), a
    measurement `height` or `heights`. A DSM brought back before ODM5 has no copy: no tab until it is brought back again.
  - **Pages:** the tab, its legend and range in m; the readout's "Ground height"; the measurement's rows.

## Video

Requested 2026-10-30 (`new.md`): planning for the analysis of DJI thermal drone video files.

### What it builds on

- **Today the app reads stills only:** a flight's files are DJI R-JPEGs (`IMAGE_EXTENSIONS` in `analyzer/api.py`),
  whose temperatures dji-thermal-cli decodes. Positions come from each image's XMP (`djixmp.py`); the files, the
  frames map, the source frames pop-out (C2), findings (C3) and the report (D1) all work per still.
- **What DJI's thermal video is** (to confirm on the user's own files): the infrared camera records an MP4
  (`DJI_<time>_<index>_T.MP4`, beside `_W`/`_Z` for the wide and zoom cameras) with the palette already applied:
  8-bit colours, not temperatures. DJI's Thermal SDK reads R-JPEGs only. With subtitles on, each video has an
  `.SRT` beside it with a line per frame: time, GPS, altitude, and for some models the gimbal and camera settings.
- **So from a video the app can know** where each frame was taken (the SRT) and what it looked like; it cannot know
  temperatures, unless the video is radiometric (some newer models) or the colours are mapped back through a known
  palette and a fixed range (approximate, and only when the range was locked during the flight).
- **Reading video** needs a decoder: PyAV (wheels that bundle FFmpeg, on Linux, Windows and macOS) or
  imageio-ffmpeg (a bundled `ffmpeg` binary). Either is a new pinned dependency, of dji-thermal-cli if the reading
  goes there, as the stills' does.

### The sample (2026-10-30)

`ignored/m4t-test-thermal.mp4`: a Matrice 4T's `DJI_20261027151837_0001_T_Waypoint1.MP4`, a 68 s point-of-interest
orbit around the house of the m4t-220 stills, about 15 m above take-off, gimbal at -45°. The mission also took
stills, but the plan does not count on them.

- **The picture:** H.264, 640×512, 30 fps, yuv420p, Ironbow already applied, and auto-ranged (each frame's range
  differs). No temperatures and no span per frame: the metadata's only range is the camera's gain, -20 to 150 °C.
  So nothing radiometric can be done (emissivity, reflected or ambient temperature, a temperature scale); what can
  be done is relative: within a frame, brighter is warmer.
- **No SRT:** the M4T writes the track into the MP4, in a `DJI meta` data track (`djmd` samples, one per frame,
  protobuf `dvtm_wa345t.proto`). Read in plain Python with no dependency (fields found on the sample):
  - `3.1.2`: the frame's time in µs; `3.3.4.1.2`/`.3`: latitude and longitude in radians; `3.3.4.2`: the absolute
    altitude in mm; `3.3.5.1`: the height above take-off in mm; `3.3.3.{1,2,3}`: the aircraft's pitch, roll and yaw
    in tenths of a degree; `3.3.2.{1,2}`: its speed in m/s; `3.4.3.{1,3}`: the gimbal's pitch and yaw in tenths
    of a degree.
  - The header (sample 0, field 1) names the drone (`DJI Matrice 4T`) and its serial; the moov's `udta` holds the
    path it was recorded under (`fsid`), and a third stream is the cover JPEG (`covr`).
- **The MRK file** the user found on the drone is DJI's photo timestamp log (for RTK); the video does not need it.

### Decisions (2026-10-30)

- **dji-thermal-cli is not involved:** there are no thermal data in the video. The app reads the MP4's track and
  cover itself, in plain Python, with no decoder: the browser plays H.264, so nothing on the server decodes frames.
- **Analysis happens in the browser**, especially stepping frame by frame or at low speed, and looping a stretch
  at several speeds.
- **Videos are copied into the data folder**, as stills are (export, import and the Storage page's move keep
  working).
- **No temperatures from video** (the old V3): the video is not radiometric and auto-ranged. Matching video moments
  to the mission's stills is possible but not counted on (Later).

### V2: decisions (2026-10-30)

- **The levels are DJI's Ironbow turned back:** checked on the sample, its colours are a median 7.6 RGB units from
  the M4T's ironred table (compression noise; every other palette is 47 or more away), and its frames use levels
  14 to 233. The table (256 colours, taken once with dji-thermal-cli's port from an m4t-220 still; the tables
  differ between camera families) ships with the front end; each frame shown is drawn to a canvas and each pixel
  takes the level of the nearest colour, through a precomputed lookup cube. Nothing on the server.
- **In place, with a switch:** the re-coloured picture takes the video's place beside the map; a switch flips
  between Original and Re-coloured, and the playback controls work in both.
- **The range is fixed, with Auto:** the range set (0 to 255 to start) stays across frames, so the colours don't
  flicker; Auto takes it from the frame shown (2nd to 98th percentile). The page says levels are relative: the
  camera re-ranges each frame, so a level is not the same heat from one frame to the next.
- **The colouring is the viewer's:** palette, range and Auto, brightness, contrast, gamma, sharpening, and an
  isotherm in levels, through `colourValues`. The palettes are the preferences' (`view_palettes`), with DJI ironred
  from the shipped table when no conversion holds DJI's; it starts as DJI ironred, so the picture starts as filmed.
- **Playback:** ±1 frame and ±1 s, speeds ⅛× to 2×, an in and an out point and a loop between them at any speed.
  Keys: Space play/pause, ←/→ a frame, Shift+←/→ a second, I/O the in and out points, L the loop, −/+ the speed.
  While playing each painted frame is re-coloured (frames skipped if it falls behind); paused, the frame shown is.
- **The readout** adds the level and pixel under the pointer.

### V3: decisions (2026-10-30)

- **A frame saved** keeps the video it is from, its time and frame number, the track's point at that time
  (position, height, gimbal), a name and notes, and the look it was shown with (Original or Recoloured, palette,
  range, tone curve, isotherm). Two PNGs go with it in the flight's folder (`datasets/<id>/video-frames/`, named by
  a key of its own, so an import needs no renaming): the picture as shown when saved, and the original frame (from
  which the levels come again exactly).
- **Saved frames are listed under the video** (a click goes back to the frame, with its look); a name, notes, a
  finding it is attached to, and delete. Removing a flight removes them; export and import carry them.
- **Both ways into reports (the user's choice):** the flight report gets a "Video frames" section, each numbered
  (V1, V2...) and placed on its map by position; a frame attached to a finding is also shown with that finding,
  in the flight's and the mosaics' reports. A finding stays a mosaic's (its temperatures); a frame only joins it.
- **The picture shown is as saved (the user's choice):** recoloured if Recoloured was on, else the original.

### Phases

1. **V1: videos in a flight** (built 2026-10-30, see Done): MP4s are added to a flight as stills are (uploaded, or
   read in place in a folder flight, as its stills are), and listed on a Videos tab with their cover, length, time and drone. Their track is read when added
   (`analyzer/video.py`) and drawn on the frames map; the video plays beside it with a marker following it, and a
   click on the track seeks to that moment.
2. **V2: analysing a video in the browser** (built 2026-10-30, see Done): each shown frame is turned back into levels (0–255) through DJI's
   Ironbow table, shipped with the app as data, then coloured as the mosaics are (`colourValues`: palette, range,
   tone curve, sharpening, a relative isotherm), always called relative, never temperatures. Step ±1 frame and
   ±1 s, speeds ⅛× to 2×, a loop between an in and an out point at any speed, keyboard keys for all of it; the
   readout gives the level and the frame's position, height and gimbal.
3. **V3: frames kept** (built 2026-10-30, see Done): the shown frame saved with its time and position, as the
   picture shown and the original (whose levels come again exactly), kept for findings (C3) and reports (D1).
4. **Later, maybe:** a path of hot spots on the map; matching video moments to the mission's stills; an SRT for
   drones that write one; a mosaic or path strip from video frames.

## Photos on the Files tab

Two requests from `new.md` (2026-10-31).

### The requests

1. On the Files tab, the RGB (visible light) photos show no time, height, pitch or distance, although they are from
   the same drone and flight as the thermal frames.
2. A **Hover for detail** checkbox beside Thumbnails, on by default. While it is on, hovering an image's link or
   thumbnail opens a pane with the full source image and its details under it, following the pointer from row to
   row. The pane's close button closes it until another image is hovered; unchecking the box closes it and keeps it
   closed.

### Decisions (2026-10-31)

- P1: read by dji-thermal-cli (its check), released and pinned here; the visual photos get their own layer on the
  flight report's map and on the frame page's map (not the Videos tab's).
- P2: the pane docked at the side; the Files tab only; selecting a row pins it in the pane, with or without Hover
  for detail (the user's addition, details under P2).

### Why the visual photos are empty (found 2026-10-31)

- The Files rows come from dji-thermal-cli's check (`thermal_analysis.file_row`). For a JPEG that is not an R-JPEG
  the check gives no `info`, so the row keeps only its path, kind and size.
- The information is there: a `_V` image has the same DJI XMP as its `_T` frame (GPS, relative and absolute
  altitude, gimbal and flight yaw, pitch and roll, the rangefinder's distance, `UTCAtExposure`) and an EXIF capture
  time, size and model. dji-thermal-cli already reads it for the visual mosaic (`mosaic.read_pose`, `djixmp`).
- What a visual photo cannot have: temperatures and the measurement settings (emissivity, distance to the object,
  humidity, reflection, ambient), which belong to the thermal camera. Its "distance" is the rangefinder's (`lrf`).

### P1: the visual photos' properties (built 2026-10-31, see Done)

- dji-thermal-cli's check returns `info` for a not-thermal JPEG with DJI XMP: camera (model, serial, size,
  capture time, UTC), geospatial (position, altitudes, GPS status, rangefinder) and attitude (gimbal pitch and yaw),
  no thermal or temperature sections; the kind stays `not_thermal`. A release (1.11.0), then pinned here.
- `file_row` fills the same columns for these rows; filters, sorting and the report's appendix pick them up.
  Existing flights get them on their next Analyze.
- The visual photos as a layer, off by default, on the flight report's map (a switch saved with the report, as the
  appendix's) and on the frame page's map of where the frames are (a switch the browser remembers).

### P2: Hover for detail (built 2026-10-31, see Done)

- On the Files tab only: the checkbox beside Thumbnails, on by default, remembered per browser as Thumbnails is.
- **The pane** is docked at the right of the window: the image at a size that fits it (a preview from the server,
  about 1280 px on its long side, cached; the M4T's visual photos are 4032×3024 and about 4.7 MB) and the row's
  columns under it. A video shows its cover. Every image and video row has it, not only the thermal links.
- **Selecting a row** (clicking its thumbnail or the row; a thermal row's name still opens the frame) shows that
  file in the pane and marks the row; clicking it again, Escape or the pane's close button deselects it.
- **Hover for detail on:** with nothing selected, the pane follows the hovered row (thumbnail or name) without a
  delay; with a row selected, the pane shows it and ignores hovering until it is deselected. The close button
  hides the pane until another row is hovered.
- **Hover for detail off:** the pane opens only for a selected row and closes when it is deselected. Unchecking
  the box closes a pane shown by hovering; a selected row keeps it.

### P3: the pane's full size image and the preferred palette (built 2026-10-31, see Done)

**The requests** (in chat): the pane can show the full size source image; a thermal image is coloured with the
preferred thermal palette (User Preferences) instead of the camera's.

**What it builds on:**
- The pane's picture is `datasets/<id>/thumbnail?file=&size=preview` (`DatasetThumbnailView`): the R-JPEG's own
  JPEG, scaled to 1280 px at most, so a thermal frame shows in the palette the camera recorded it with. No view
  serves a photo at full size yet.
- **The preferred palette:** `app_palette()` ("" for "As each flight's images"). `palette_colors()` and `coloured()`
  in `exports.py` colour a frame's values with it (DJI's palettes read from the frame itself, or the app's colour
  maps), and `auto_range()` gives a range from the values' percentiles.
- **Measuring a frame without a conversion:** `api.measure(path, api.Settings(), unit)` with the frame's own
  parameters takes 20–50 ms for an M4T frame (640×512).

**Proposed design:**
- **Server:** the thumbnail view colours a thermal row with the preferred palette, over the frame's own 2–98 %
  range. "As each flight's images", a DJI palette the frame doesn't hold, or a frame that can't be measured all
  keep the camera's JPEG. `?size=full` serves the image at its own size: a visual photo as the file is, a thermal
  frame recoloured. The palette is part of the URL (`&palette=`), so changing the preference isn't hidden by the
  browser's cache.
- **Pane:** a "Full size" button under the picture.

**Decisions (2026-10-31):**
- **Full size opens as an overlay** over the Files tab. It fits the window at first. The wheel zooms, a 1:1 button
  shows it pixel for pixel, and dragging pans. Escape or × closes it, leaving the tab as it was.
- **Every thermal picture on the tab** follows the preferred palette: the table's thumbnails, the pane and the full
  size.
- **Tests:** pytest on the views (the colours follow the preference, the fallbacks, the full size); Vitest on the
  button; a live check on m4t-220 with a DJI palette and an app palette.

## Usability

Requested 2026-10-31 (new.md): "Using your expert ux designer skills, how would you make this ui more intuitive?"

### What it builds on

- The pages as they are after P2: Projects, a project, a flight (Files, Problems, Videos and the other tabs), a
  dataset's mosaics viewer, the frames explorer, compare, the flight and mosaic reports, Preferences, Storage, ODM.
- The names already settled (Project › Flight › Dataset, I1), the facelift (B) and the navigation pane.

### Proposed phase

- **U1: the review.** Every page walked through on the user's real data in a browser (light and dark, a wide and a
  narrow window), following the tasks a first-time user has: make a project and a flight, add images, read the
  analysis, convert, open a mosaic, measure, keep a finding, write the report, export, send to ODM.
  - For each step: where a user hesitates (what to do next is not shown, a word that needs the manual, a control
    far from what it acts on, a state that is not visible, an action with no feedback or no undo).
  - Findings ranked by how much they get in the way, each with a proposed change and a screenshot, written up for
    the user to read.
  - Nothing is built in U1: the user picks the findings that become phases (U2 onwards).

### Decisions (2026-10-31)

- **Write-up:** a private artifact page (claude.ai), the findings ranked with their screenshots; the findings' titles
  are listed here too, so later phases can point to them. Screenshots follow the docs' rule: no GPS coordinate,
  address or basemap shows.
- **Observation:** Claude's walk-through only; the user may add findings of their own later.
- **Data:** the user's own instance on 8080. What the walk-through creates (a project, a flight added in place from
  `ignored/`, its datasets, measurements, findings, report text) is deleted at the end, and what it changes on
  existing records is put back.

### U1's findings (2026-10-31)

The write-up, with what happens, the proposed change and screenshots for each: the private artifact
https://claude.ai/artifact/Ee3uCoiQKCYA1rjYG7ZmA5. Ranked; the user picks those that become phases (U2 onwards).
- **Blocks:**
  1. After the analysis, nothing shows that converting comes next (the flight page's tabs; the Convert tab's form
     open, its outputs named as in dji-thermal-cli, the button at the bottom).
  2. The Problems tab gives command-line advice, with nothing to apply it (in °C whatever the unit; files listed
     twice; internal codes shown).
  3. The viewer opens on the banded Mosaic, and nothing points to Harmonized.
  4. A flight's datasets are listed at the bottom of the Convert tab.
- **Slows:**
  5. Two sets of drawing tools in the viewer's side panel (Source frames, Measure), and a finding takes three steps.
  6. A measurement's result appears far from the map, in a side panel of eleven open sections.
  7. Two different reports (the flight's, the dataset's) are both called "Report".
  8. Datasets are named "Dataset 1", "Dataset 2" by default.
  9. The New flight dialog has two different "folder" options; the in-place path is typed; no name from the folder.
  10. The navigation pane repeats every tab, four levels deep ("Tools").
- **Polish:**
  11. While the analysis runs, the page shows the full conversion form; "Cancel" doesn't say what it cancels.
  12. The Files table: "Thermal frame" duplicates Kind, "With problems" is a bare tick, uneven row heights.
  13. A dataset card's menu styles three items as links; the flight rows' icons are named only in tooltips;
      Compare's toggles look like buttons; the basemap list stays light in the dark theme.
  14. Settings are in three places; Storage is hidden under System Settings.
  15. The report pages don't say their text is saved.

### Phases from U1's findings (2026-10-31)

The user took all fifteen findings (2026-10-31: "I agree with everything you called out"), to be made into phases
and each planned with them. Grouped by the page they change, the main path first:
- **U2: the flight page's path from the analysis to a dataset** (findings 1, 4 and 11): what comes next shown once
  the analysis is done, the datasets in front of the form, the form folded with its outputs named for what they are,
  the Convert button above it, and the analysis's own progress while it runs.
- **U3: the Problems tab** (2): its advice in the Convert form's words, each with a button that opens the form with
  that setting set; temperatures in the preferred unit; the files listed once; the codes in a tooltip.
- **U4: the viewer's first view** (3): open on Harmonized, or say why to look at it, when the frames disagree; a
  line saying what each of its tabs shows.
- **U5: measuring in the viewer** (5 and 6): one set of drawing tools, a shape's temperatures in a card on the map
  with "Keep as finding", "Save measurement" and "Source frames"; the side panel grouped.
- **U6: names** (7, 8 and 9): the two reports named by what they cover; a dataset named after its settings by
  default; the New flight dialog's two folder options named by what they do with the files, the name taken from
  the folder.
- **U7: the navigation pane and the settings pages** (10 and 14): the pane stops at project, flight and dataset;
  Storage listed beside the other settings pages, all three in the same column.
- **U8: polish** (12, 13 and 15): the Files table's columns and rows; menus, the flight rows' actions, Compare's
  toggles and the basemap list in the dark theme; "Saved" on the report pages.

### U2: the flight page's path from the analysis to a dataset (built 2026-10-31, see Done)

On the flight page as it is: the tabs are Files, (Videos,) Problems, WebODM plan and Convert; before the analysis
only Convert shows. The Convert tab's settings start open while the flight has no dataset, the Convert button is
below them, and the flight's datasets are listed under the form, with a running conversion's progress there too.
Proposed:
- **The Convert tab becomes "Datasets"**, with its count: the flight's datasets first, then the way to make one.
  The way back from the viewer and the frames explorer (`#convert`) opens it; the frames explorer's "convert again
  with these" link still opens the form filled in.
- **Making a dataset:** a "New dataset" bar with the settings summary (the chips), the name and the Convert button;
  the settings fold under "Change settings", folded by default (opened by "Use settings", the WebODM plan's button
  and a filled-in link, as today).
- **The outputs named for what they are for**, the dji-thermal-cli name in small type beside each, its own
  description as the tooltip: temp_c, temp_f, temp_k "Temperatures (°C / °F / K), for measuring"; temp_ck
  "Temperatures in 16-bit integers (centi-kelvin)"; temp_dc "Temperatures as the DJI SDK gives them"; raw "Raw
  sensor values"; gray16 "16-bit greyscale picture"; pseudo "Coloured picture (the palette)"; rjpeg "DJI R-JPEG".
- **Next step shown:** once the analysis is done and the flight has no dataset, a band above the tabs: "Next: make
  a dataset", with how many thermal frames it will convert.
- **While the analysis runs:** "Reading 120 of 220 files" with the bar, the form not shown; the header's button says
  "Cancel the analysis".
- Object distance's help leaves out what isn't known yet.

### U2: decisions (2026-10-31)

- **Tabs:** one "Datasets (n)" tab in place of Convert: the datasets first, then the New dataset bar (chips, name,
  Convert), the settings folded under "Change settings".
- **First tab:** Datasets once the flight has a dataset; Files before that (Convert before the analysis, as now).
- **The "Next: make a dataset" band's button** opens the Datasets tab with the New dataset bar in view; it does not
  start a conversion.
- **Outputs:** the plain names above, dji-thermal-cli's name in small type beside each, its description the tooltip.

### U3: the Problems tab (built 2026-10-31, see Done)

On the flight page as it is, the Problems tab shows dji-thermal-cli's own sentences: the message, then its advice in
flags (`--mosaic-normalize`), temperatures in the analysis's °C whatever the preferred unit, the files named in the
message and again as chips, and the code (`ambient_temp_varies`) under each. The report shows the same.
Proposed (each file's row in the analysis has the values the text needs, so neither dji-thermal-cli's sentences are
parsed nor dji-thermal-cli changed):
- **The app's own text for each code** dji-thermal-cli reports, its numbers taken from the files' rows; a code the
  app doesn't know shows dji-thermal-cli's text, as now.
- **Temperatures in the preferred unit** (a spread converted as a difference).
- **The files listed once**, as the chips, each with its value where the problem has one.
- **The code in a tooltip** on the severity badge.
- **A button on a problem a setting fixes:** it opens the Datasets tab with the New dataset form unfolded and that
  setting changed on top of the form's values, with a note saying what changed; nothing is converted (as the WebODM
  plan's "Convert with these"). The report shows the text, without buttons.

### U3: decisions (2026-10-31)

- **Ambient (or reflected) temperature varies:** one button, "Normalize the frames to each other"; no "one ambient
  temperature" button.
- **Unusual maximum or minimum temperature:** no button, the advice in the form's words only (Replace above/below,
  the colour range). An unusual mean: "Normalize".
- **Oblique frames left out of a mosaic:** "Include them" (raises "Only frames with a gimbal pitch at or below")
  only when the flight has too few nadir frames for a mosaic; text only otherwise.
- **The other buttons:** emissivity or humidity differs, "Use one emissivity (0.95)" (the value most files have);
  the rangefinder reads another distance than the embedded one, "Use the embedded distance"; a rangefinder reading
  missing or unusual, "Use one distance (20.9 m)" (the median reading). No button where no setting fixes it.

### U4: the viewer's first view (built 2026-10-31, see Done)

In the mosaics viewer as it is: the tab bar is Mosaic, Harmonized, Source frame, View angle (and Visual); it opens on
the tab a link names (the URL, a reload, the navigation pane), else always on Mosaic. Each tab's explanation is the
line at the top of its side panel, seen only once the tab is open. dji-thermal-cli reports each frame's offset
against its neighbours (the Mosaic's "Frame offsets", `frame_offsets.offset_c` with `p5_p95_span`) but has no
threshold for "too much". On the user's flights the middle 90% of the offsets span 1.6 and 1.8 °C; on U1's m4t-220
(the bright strips) about 39 °C.
Proposed:
- **The frames disagree** when the as converted mosaic's offsets span more than 3 °C over their middle 90%
  (`p5_p95_span`): one frame far off doesn't count, and the user's flights stay on Mosaic.
- **A tab a link names still wins**; the choice below is only for a viewer opened without one.
- **Each tab gets a tooltip** with a short line saying what it shows.

### U4: decisions (2026-10-31)

- **When the frames disagree:** the viewer opens on Harmonized, with a notice above the tabs saying why ("Opened on
  Harmonized: the frames differ by up to 71 °F where they overlap, which Harmonized evens out. Mosaic shows each frame
  as converted."), which can be closed. Otherwise it opens on Mosaic, with no notice.
- **What each tab shows:** a tooltip on each tab; the longer explanation stays at the top of the side panel.

### U5: measuring in the viewer (built 2026-10-31, see Done)

In the mosaics viewer as it is, on a temperature tab (Mosaic, Harmonized), the side panel holds the palette and range
and ten sections: Image, Pointer info, Source frames, Measure, Isotherm, Parameters, This mosaic, Saved measurements,
Findings, The mosaic. Source frames has its own tools (Spot, Area, Box, Circle: drawing opens the source frames
window) and Measure its own (the same and Line: the result in the section, with a name field, Save and a "Source
frames" button). A finding takes three steps once drawn: Source frames, "Save as finding" in the window, the form.
The frames explorer has the same Measure section (sizes in pixels, no source frames, no findings); the compare page
measures nothing, each pane's header holding a Source frames toolbar (Spot, Area).
Proposed:
- **One toolbar** for measuring and the source frames: Spot, Line, Area, Box, Circle.
- **A card on the map** for the shape drawn: its temperatures and profile or histogram, with "Keep as finding" (the
  form at once, the source frames window beside it to pick the frames kept), "Save measurement" (named in the card)
  and "Source frames"; a line has only "Save measurement". Closed by × or Esc. A saved measurement shown opens its card.
- **On the Source frame and Visual tabs** (no temperatures) drawing opens the source frames window, as a click does.
- **The side panel** loses Source frames and Measure; the rest goes under headings.

### U5: decisions (2026-10-31)

- **The toolbar is on the map:** icons along the map's top edge, right of the zoom buttons, each with a tooltip;
  Finish and Cancel beside it while drawing.
- **The side panel under headings:** View (palette and range, Image, Isotherm), Values (Pointer info, Parameters, This
  mosaic), Kept (Saved measurements, Findings), then The mosaic. On a first visit Image, Parameters, This mosaic and
  The mosaic start folded; after that each stays as it was left.
- **All three pages:** the frames explorer gets the toolbar on its frame and the card (temperatures, "Save
  measurement"), its panel under the same headings. The compare page's Spot and Area move onto each pane's map, in the
  same toolbar; drawing still opens the source frames window. Compare gains no measuring (that would be a phase of
  its own).
- **Settled while building:** The mosaic sits under its own heading, About; on the frames explorer the headings are
  View (palette and range, Image, Isotherm), Values (Pointer info, Measurement parameters), Kept (Saved on this frame)
  and About (This frame, Where the frames are), with Image, Measurement parameters and This frame folded on a first
  visit. Keeping a shape as a finding closes its card (the finding is drawn instead). The Findings list's empty text
  points to drawing a shape and keeping it.

### U6: names (built 2026-10-31, see Done)

As they are: the flight page's header has a "Report" button (the flight report) and the mosaics viewer's header a
"Report" button (the mosaic report); the navigation pane lists "Report" under a flight and under a dataset's Tools;
both report pages are titled "<name> report". A dataset converted with no name typed is called "Dataset <n>" by the
server. The New thermal flight dialog offers "Upload images" (Choose images, Choose a folder: both copy the images)
or "A folder on this computer" (a typed path, read in place); the name comes from a chosen folder only.
Proposed:
- **The reports named by what they cover:** "Flight report" (flight page, navigation pane) and "Mosaic report"
  (viewer, navigation pane); their pages titled "<name> · Flight report" and "<name> · Mosaic report".
- **A dataset's default name from its settings,** shown as the Datasets tab's name placeholder before converting.

### U6: decisions (2026-10-31)

- **A dataset's default name:** the settings that differ from dji-thermal-cli's defaults and change its temperatures
  or mosaics (mosaics, distance, the measurement parameters, normalizing, the pitch limit, the gimbal, replacing
  above or below), e.g. "Normalized · pitch ≤ -60°"; "Default settings" when none does. Outputs, compression,
  palette, range, unit and the visual mosaic are left out. A name the flight already has gets " (2)", " (3)". The
  Datasets tab shows it as the name field's placeholder and sends it; the server's "Dataset <n>" stays only for an
  API call with no name.
- **Existing datasets** keep their names.
- **The New thermal flight dialog loses "A folder on this computer"** (the user: an edge case; images and a folder
  chosen from the computer are enough): Choose images and Choose a folder only, both copying. Flights already read in
  place keep working (their pages, the Storage page, a backup restored with its folders kept), and the API still
  takes `source: folder`.

### U7: the navigation pane and the settings pages (built 2026-10-31, see Done)

As they are: the pane lists Projects › flights › under each flight "Flight report" and its datasets › under each
dataset Tools (Compare, Mosaic report), Mosaics (one row per viewer tab) and Frames (Mosaic, Oblique, with counts),
then User Preferences, and System Settings, which folds to show Storage. What the pane unfolds to show the page shown
is not remembered, so it folds again on the next page. The frames explorer's lists (in the mosaic, oblique) are
reached only from the pane. The Storage page is full width; User Preferences and System Settings are a 720 px column.
Proposed:
- **The pane stops at Projects › flights › datasets.** A dataset's row opens its viewer (else its frames explorer,
  else its flight's Datasets tab); on any of its pages (viewer, Compare, Mosaic report, frames explorer) the dataset
  is marked, on the Flight report its flight. The server's navigation stops sending the viewer's tabs and the frame
  counts.
- **The frames explorer's own list switch,** above its frames once the mosaics are built: All · In the mosaic (n) ·
  Oblique (n), kept in the URL as now.
- **Storage beside the other settings pages** in the pane, and in the same 720 px column.

### U7: decisions (2026-10-31)

- **No "Flight report" row** in the pane: it is opened from the flight page's header.
- **What the pane unfolds stays unfolded** (remembered as a fold the user made), so it only folds when clicked.
- **The settings pages are three rows** at the pane's foot, each with its icon: User Preferences, System Settings,
  Storage; System Settings no longer folds.

### U8: polish (built 2026-10-31, see Done)

As they are:
- **The flight page's Files tab:** "Thermal frame" (a tick) repeats Kind. "With problems" is a tick. The Notes column
  shows dji-thermal-cli's codes (`ambient_temp_varies`) as badges, which wrap and make those rows taller.
- **A dataset card's "…" menu** (the flight page's Datasets tab): Frames, Compare with… and Download all are links
  with no padding; the items below them are buttons.
- **A project's Flights table:** each row ends in four icons (Rename, Analyze again, Move to another project as a
  folder, Delete), named only in tooltips; a long name wraps onto three lines. The Projects table leaves Findings
  empty for 0.
- **Compare's header:** Linked, Shared palette and Findings are buttons tinted when on, and the first two change
  their label (Unlinked, Each pane its own).
- **The maps' basemap list** is drawn light (`#fff`) in the dark theme.
- **Both report pages already say "Saved"** beside the Print button after each save (U1's finding 15 missed it), but
  nothing shows before the first save, and while the figures are drawn the "waiting" text takes its place.

Proposed:
- **Files tab:** "Thermal frame" goes (the "Thermal frames" button filters on Kind; a link or saved filter with
  `thermal_frame` is read as Kind). "With problems" and Notes become one **Problems** column: each problem a short
  name on its severity's colour, the full sentence its tooltip, then a file's reason or warnings; one line per cell,
  so every row has the same height. The "With problems" button and filter stay.
- **Menus:** every item of a "…" menu styled alike, links as buttons.
- **Flights table:** one "…" menu per row with Rename, Analyze again, Move to another project and, under a divider,
  Delete in red; the name stays on one line. The Projects table shows 0 findings.
- **Compare:** the three toggles keep one label each ("Link the panes", "Shared palette", "Findings"), pressed in
  with a check mark when on.
- **The basemap list** in the theme's colours.
- **Reports:** "Saving…" while typing waits to be saved, then "Saved"; before anything is typed, "Typed text is
  saved as you type"; the waiting text beside it, not in its place.

### U8: decisions (2026-10-31)

- **Files tab:** one Problems column in place of "With problems" and Notes, as above.
- **Flight rows:** all four actions in the "…" menu.
- **Compare's toggles:** pressed, with a check, one fixed label each (not switches).

## Secrets

Requested 2026-10-31 (new.md): "securely salt and encrypt the password in the .env file. I'm aware the key will still
be stored on disk but significantly more difficult to use. Maybe store the key in the database".

### What it builds on

- `analyzer/webodm.py`: `WEBODM_URL`, `WEBODM_USERNAME` and `WEBODM_PASSWORD`, read from the environment or a `.env`
  file (`analyzer/envfile.py`: the start folder's, then the data folder's), written there by System Settings › WebODM
  once WebODM has taken the login. The password is never sent to the browser; it is in the file as typed.
- The database (`db.sqlite3`) and the secret key file live in the data folder; a data-folder move carries both, and
  the data folder's `.env` with them. A project's backup carries neither the database's other rows nor `.env`.
- The Mapbox token is in `.env` too, but the browser is sent it to draw the map, so encrypting it hides nothing.

### Proposed phase

- **S1: the WebODM password encrypted in `.env`** (built 2026-10-31, see Done).
  - A random key, made once and kept in the database (a row of its own, never in what the API sends), not in `.env`:
    `.env` alone (copied, shared, committed by mistake) no longer gives the password away.
  - Saving writes `WEBODM_PASSWORD=enc:<token>`: authenticated encryption with a fresh random IV each time (so the
    same password never reads the same twice, the salt asked for), and tampering is detected.
  - Reading decrypts an `enc:` value; a plain one (set by hand, or in the environment) still works as it is.
  - A password the key can't open (the database replaced, the value edited) is shown on System Settings › WebODM as
    "The saved password can't be read: enter it again", not as a failed login.
  - Remove takes the key out along with the three values.

### Decisions (2026-10-31)

- **Library:** `cryptography`'s Fernet, pinned exactly (50.0.2).
- **The key:** in the database, a table of its own; a different data folder can't read the password.
- **A plain password already saved in a `.env` file:** encrypted in place when the app starts; one set in the
  environment is left alone.
- **Order:** before W1, so the docs describe it.

## Platforms

Requested 2026-10-31 (new.md): the app supports Linux, Windows and macOS. Windows can be checked from the
development machine (WSL); a Mac needs the user to pull and run the tests there, so tests that need one are kept to
those that are truly necessary, not there for coverage.

### What it builds on

- CI on Linux and Windows (on a `v*` tag or by hand); "On another machine (macOS too)" in CLAUDE.md.
- The code that differs by platform: `cli.py` (the restart and the browser on Windows), `datadir.py` and
  `envfile.py` (file modes), the `os.replace` calls (a file open elsewhere on Windows), `move.py` (links),
  `dji-thermal-ui.sh` (bash and the BSD tools on macOS), and file names in exports (case and characters that
  Windows and macOS refuse or fold).
- The tests guarded by platform: `POSIX` in `test_webodm.py` and `test_basemaps.py` (file modes),
  `test_script.py` (skipped on Windows).

### Proposed phase

- **X1: platforms checked.**
  - Read each place above for what really differs on each platform; fix what is wrong on its own branch.
  - Run the full suite natively on Windows from WSL, and the command and the pages on Windows too.
  - Keep a platform-guarded test only where it checks behaviour that really differs; drop or merge any that only
    adds coverage.
  - Make the Mac's list as short as it can be: only what a Mac alone can show (likely `dji-thermal-ui.sh` under the
    Mac's bash and tools, and the default data folder), as one command the user runs after pulling.

- **Built** (2026-11-01): see Done.

### Decisions (2026-11-01)

- **macOS in CI:** a job of its own (the tests on Python 3.12, and the built wheel serving its pages), wired up but
  off: it runs only while the repository variable `MACOS_CI` is `true`, so the user turns it on in the repository's
  settings, with no commit, once there are minutes for it (they ran out again). Until then the Mac's check is by
  hand.
- **The repository is public** (the user, 2026-11-01), so its Actions minutes are free, macOS's too. CI still runs
  only on a `v*` tag or by hand (the user's decision that day); the macOS job is still turned on by `MACOS_CI`.

## Documentation

Requested 2026-10-31 (new.md): "Plan to setup the github repo to host the documentation." and "Plan out the
documentation. We'll also want to provide quickstart tutorials with screenshots and then maintain the documentation
as feature changes require going forward."

### What it builds on

- The README (389 lines): what the app does, page by page, then Install, Run, the maps, WebODM, where the data lives,
  Development. It is the only user documentation; the CHANGELOG says what changed in each release.
- The repository is private, on a personal account. GitHub Pages publishes from a private repository only on a paid
  plan (Pro or above), and the site is public even then; on GitHub Free the repository must be public. The wiki is
  turned off (a private repository's wiki also needs a paid plan).
- CI runs only on a `v*` tag or by hand (`.github/workflows/ci.yml`); a private repository's minutes are billed.
- The live checks' Playwright scripts, which already drive every page on a scratch instance (port 8081).
- Material for MkDocs, the usual Python choice, went into maintenance mode in November 2025; its successor from the
  same team, Zensical, reads the same `mkdocs.yml`.

### Proposed phases

- **W1: the docs site.** A `docs/` folder of Markdown pages built into a static site (Zensical, or Material for
  MkDocs pinned), checked by a strict build in CI (broken links and missing pictures fail it), and published by a
  workflow on a `v*` tag or by hand, never on a push. The pages are laid out: Getting started (install, first run),
  Quickstart tutorials, the user guide (a page per part of the app, as the user sees it: Projects, a flight's tabs,
  datasets and mosaics, measuring, findings, reports, compare, exports, preferences and settings, storage, WebODM),
  and Reference (the command, where the data lives, the API).
- **W2: the user guide.** The README's feature list and its sections moved into the guide's pages and written as
  pages to read; the README keeps what the app is, how to install and run it, and a link to the site.
- **W3: quickstart tutorials with screenshots.** Short tutorials following a first-time user's tasks (the same as
  U1's): make a project and a flight, read the analysis, convert and open a mosaic, measure and keep a finding, print
  the report, export. The screenshots are made by a committed script (Playwright, pinned) against its own instance
  with a known data set, light theme, fixed window size, so they can be made again in one command when a page
  changes.
- **Keeping it current (a rule, not a phase):** a change that adds or changes a feature updates its guide page on
  the same branch, as the README rule says today, and makes again the screenshots of the pages it changed (a
  `.claude/skills` procedure, pointed to from CLAUDE.md). The strict build catches broken links and pictures.

### Decisions (2026-10-31)

- **Hosting:** a separate public repository (`dji-thermal-ui-docs`) holds the built site, published with GitHub
  Pages (free, and its Actions minutes are free). The pages are written here, in `docs/`; the code stays private. The
  site is copied over at a release (the user pushes it there, as with any push).
- **In the app too:** the built site ships in the wheel, like the page code, and the app serves it at `/help` from a
  Help link in the header, so the docs match the version installed and work offline.
- **Screenshots:** a real flight, with its location hidden: the basemap turned off, and the coordinates, the
  address and the serial numbers replaced in the shots.
- **Order:** U1 first, then W1–W3 (W1 may start before U1's changes are built, as it has no screenshots), then X1.

- **Generator:** Zensical (decided 2026-10-31).
- **README:** keeps what the app is, how to install it and how to run it; everything else points to the
  documentation (decided 2026-10-31).
- **Screenshot data:** the flight "m4t-test-flights" (in "Default Project") on the user's own instance. No GPS
  coordinate or address may show
  anywhere in a screenshot (maps without a basemap, coordinates, the project's location and the frames' positions
  replaced or hidden); the images themselves can be shown as they are (decided 2026-10-31).

### W1: the docs site (planned 2026-10-31)

- **Built** (2026-10-31): see Done. Zensical's strict build fails on a broken link but not on a missing picture, so
  `tests/test_docs.py` checks the pictures (and that every page is in the navigation).

- **Pages:** `docs/` with Zensical's `zensical.toml`, laid out as Getting started, Quickstart, User guide (a page per
  part of the app) and Reference (the command, its options and environment variables, where the data lives). W1's
  guide pages say what each will hold; W2 fills them from the README, W3 adds the tutorials.
- **Build:** Zensical pinned in a `docs` dependency group; `uv run --group docs zensical build --strict` writes the
  site to `src/dji_thermal_ui/static/docs/` (gitignored, like `static/dist`), which the wheel and sdist carry;
  `check_dist.py` requires it and `smoke.py` fetches `/help/`. CI builds it before `uv build` (still only on a `v*` tag
  or by hand).
- **In the app:** `/help/` serves the built site; without a build it says how to make one. A **Help** link in the
  page header, beside the version, opens the guide page for the page you are on, in a new tab (decided 2026-10-31).
- **Publishing:** the public `dji-thermal-ui-docs` repository serves the site with GitHub Pages from its `main`
  branch (no Actions). `scripts/publish_docs.py <checkout>` copies the built site into a local clone of it and
  commits there; the user pushes.
- **Reference:** the command and the data only, not the REST API, which belongs to the pages and changes with them
  (decided 2026-10-31).
- **Keeping it current:** a `.claude/skills` procedure, pointed to from CLAUDE.md.

### W2: the user guide (planned 2026-11-01)

- **Built** (2026-11-01): see Done.
- **Text:** the README's feature list and its sections (the maps, WebODM, where the data lives) move into the guide's
  pages, written as pages to read in the app's own names: each page for the part of the app it describes, Install
  and Run into Getting started, the command's options into Reference › Command, the data folder into Reference ›
  Data. The REST API lines are left out (W1's decision).
- **README:** keeps what the app is (a short list linking to each guide page), Install, Run, Development (for
  whoever works on the code) and Licence, and links to the documentation for the rest.
- **Checks:** the strict build, `tests/test_docs.py`, the header test of the Help targets, and `/help/` looked at on
  an instance of the branch.

### W3: quickstart tutorials with screenshots (planned 2026-11-01)

- **Built** (2026-11-01): see Done. The serial numbers are masked too (the decision of 2026-10-31), and the data
  folder's path shown as Linux's default.
- **Script:** `scripts/screenshots.mjs` (Playwright pinned in `package.json`), run as `npm run screenshots --
  <images folder>`. It starts its own instance on 8081 with scratch data and config folders, does the tutorials'
  steps as a first-time user (a project, a flight, the images uploaded, the analysis, a dataset, the mosaic, a
  measurement, a finding, the report, an export), shoots as it goes (light theme, 1280 × 800, PNG in
  `docs/assets/screenshots/`), and stops its instance by its PID. The user's 8080 server is never touched.
- **Data:** a fresh instance fed with the images of "m4t-test-flights" (327 thermal and 327 visual), read from the
  user's data folder and uploaded; the script analyzes, converts and builds the mosaic itself (several minutes a
  run), and runs on another machine given the folder (decided 2026-11-01).
- **Location:** no basemap and no project location on the scratch instance; whatever shows coordinates is hidden;
  before each shot the script fails if the flight's latitude or longitude appears in the page's text.
- **Pages:** the Quickstart tutorials (`docs/quickstart/`, a page per task, a few steps and a shot each), and one or
  two shots at the top of each User guide page (decided 2026-11-01).
- **Upkeep:** the update-docs skill says to run the script again when a page changes.

## Finer slider steps

Requested 2026-10-31 (`new.md`): the image sliders (Brightness, Contrast etc.) should move in smaller steps, about
50% smaller. Builds on F1, whose steps were made 5% finer.

### T1: the image sliders' steps halved

- **Built** (2026-10-31): see Done.
- **Steps:** half of F1's, still a whole number from end to end: brightness 2/42 → 2/84, contrast 4/42 → 4/84,
  gamma 4.6/48 → 4.6/96, sharpening 5/11 → 5/22. They are the sliders under Image in the panel of the viewer, the
  frame page and the video tab, and Gamma and Sharpening on the compare page (`SLIDERS`, `viewer/view.ts`); the
  compare page's Opacity and the video's Time are left as they are.
- No decision was open: the request named the size. The finer gamma steps were checked not to stick at its low end,
  where gamma is rounded to 0.01.

## Name and banner

Requested 2026-11-01 (new.md): "The title and display name of this app should be DJI Thermal Analyzer", and "make
./dji-thermal-analyzer.jpg the backsplash image of the readme and for the docs. Move it to an appropriate location
that is checked in. Resize copies of the source image as needed for their destination purpose."

### What it builds on

- The name shown today is "Thermal Analyzer": the header (`components/header.tsx`), every page's `<title>`
  (`templates/page.html`, and `document.title` in the dataset, viewer and report pages), hints on the preferences and
  settings pages, a deletion message (`core/format.ts`), `help_missing.html`, the docs' `site_name` and copyright
  (`zensical.toml`), `docs/index.md` and other guide pages, and the checks that look for it (`scripts/smoke.py`,
  `tests/test_pages.py`, `tests/test_cli.py`, `tests/test_api_storage.py`, Vitest's `dataset` and `datasets` tests).
  The README's title is the package name, `dji-thermal-ui`.
- The command, the package and the repositories are `dji-thermal-ui` (and `dji-thermal-ui-docs`).
- The image: 3168 × 1344 JPEG, 3.1 MB, untracked at the top of the clone. It shows DJI's logo beside "Thermal
  Analyzer".
- The README is also the package's description (`readme` in `pyproject.toml`), shown on PyPI once it is published;
  the repository is private, so a picture there must come from a public address (the docs site) to show on PyPI.

### Proposed phase

- **N1: the name and the banner.**
  - Every name a user sees says DJI Thermal Analyzer: the header, the page titles, the hints and messages, the
    docs' site name, the README's title; the tests and smoke check follow.
  - The source image is kept in the repository (`docs/assets/source/`, outside the built pages), with resized copies
    for each use: a banner for the README and the docs' home page (1600 px wide, and a 3200 px one for sharp
    screens on the docs), as JPEGs of a few hundred kB. The README shows the copy the docs site publishes, so it
    shows on GitHub and on PyPI alike.

- **Built** (2026-11-01): see Done.

### Decisions (2026-11-01)

- **Scope:** only the shown name changes. The command, the package and the repositories keep `dji-thermal-ui`.
- **The image:** the user replaced it with one that spells DJI in plain letters instead of DJI's logo; it is used on
  the public docs site and in the README as it is.

## Spelling

Requested 2026-11-01 (new.md): "license is spelled incorrectly in the readme. Check for other misspellings as well."

### What it builds on

- The README's heading `## Licence` and "their licences" are British spellings, not typos: the whole project is
  written in British English (colour, colouring, behaviour, grey, centre, metres, favourite, analyse), in the README,
  the docs, the pages' text and the code (`colour.ts`, `colouring.py`, `thermal-analyzer.*` aside). The file names
  `LICENSE` and `THIRD-PARTY-LICENSES.txt` are already American.

### Proposed phase

- **T1: spelling.**
  - Run a spell checker over the README, `docs/` and the pages' strings, and fix the real misspellings it finds.
  - The screenshots are made again only if a word they show changes.

### Decisions (2026-11-01)

- **Spelling:** British stays (licence, colour, behaviour); only real misspellings are fixed.

## Creating the WebODM account

Requested 2026-11-01 (new.md): under System Settings › WebODM, a button that creates the WebODM account the app
uses. The user types WebODM's address and an admin account's user name and password; the app creates its own user
(named like `dji-thermal-ui-api-user`) with the permissions it needs, with a password the user chooses.

### What it builds on

- System Settings › WebODM (`frontend/src/settings/webodm-settings.tsx`) asks for the address, user name and
  password, checks them by logging in and saves them to `.env`, the password encrypted (S1). Its "Setting up the
  WebODM account, and the permissions it needs" explains the steps a WebODM admin takes by hand.
- WebODM's API (read in LuxODM's copy): `POST /api/admin/users/` with `{username, password}` creates a user; only a
  staff account may call it (`IsAdminUser`), and it hashes the password. WebODM adds every new user to its
  **Default** group, which holds the project, task, preset and processing-node permissions the app needs.
  - A processing node is offered to the Default group only if it was there when WebODM first started; a node added
    later needs **Can view Processing Node** given to the account by hand, and the API has no way to give it.
  - The API's PATCH of a user stores the password unhashed, so the app never changes an existing user's password.

### Proposed phase

- **O1: creating the WebODM account.**
  - On System Settings › WebODM, beside the login form: **Create the account** opens a small form with the address,
    the admin's user name and password, and the new account's name (filled with `dji-thermal-ui-api-user`) and
    password.
  - The server logs in as the admin, creates the account, then logs in as it and lists the processing nodes it sees,
    and saves the new account (not the admin's) to `.env` as "Check and save" does. The admin's password is used
    for that one request: never saved, logged or sent back.
  - Refusals say what to do: an admin that is not staff, a name already taken (choose another, or type that
    account's password in the login form), a password WebODM refuses.
  - If the new account sees no processing node, the page says which step of the manual instructions gives it one.
  - Hidden when the login is set in the environment (as the form's fields are now).
  - The docs' WebODM page, the README and the CHANGELOG say how.

### Decisions (2026-11-01)

- **The new account's password:** typed by the user, or filled with a long random one by a **Generate** button; the
  app saves it, so it is never typed again.
- **A name already taken:** refused, saying to choose another or to type that account's password in the login form.
  The app never changes an existing WebODM account.

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
- **B1: the pages rebuilt, release 0.2.0** (2026-10-27). The five pages in TypeScript and Preact (`frontend/src`,
  one Vite entry per page in `frontend/src/pages`), Leaflet 1.9.4, the app's own stylesheet
  (`frontend/src/styles/app.css`) with light and dark tokens, the theme in the preferences and the header; the build
  in `src/dji_thermal_ui/static/dist/` (gitignored, shipped in the sdist and wheel) read by the `{% vite_entry %}` tag
  (`analyzer/templatetags/vite.py`). Bootstrap, Font Awesome, the old scripts and Jest removed. Tests: Vitest
  (`frontend/tests`, 138), pytest against a stub manifest (`tests/data/vite-manifest.json`), ESLint with tsc. CI
  builds the pages before the distributions; `check_dist.py` requires each page's entry and files. The walk-through
  found three bugs, fixed (one, the black legends of rio-tiler's colour maps, on `main` since A2). Release checks
  passed on Linux (check_dist, twine, smoke on 3.12 and 3.14, ruff, 129 pytest, 138 Vitest, ESLint) and on Windows
  from WSL (129 pytest from a fresh clone, smoke on 3.12 and 3.14).
- **B2: the map pages on OpenLayers, release 0.3.0** (2026-10-27). The viewer, compare and frame pages on
  OpenLayers 10.11.0 (`frontend/src/map/map.ts`), Leaflet removed. The server sends float32 values
  (`data_response` in `analyzer/api.py`: `mosaics/<tab>/data/`, `mosaics/<tab>/difference/data/`, `frame/data`, with
  `X-Width` and `X-Height`), and the browser colours them (`frontend/src/map/colour.ts`): a WebGL style with the
  tone curve baked into the palette, the isotherm, and sharpening as a 5 × 5 kernel in the shader; the same on a
  canvas for the compare page's picked frames (`colourValues`). The PNG tiles and frame image, the server's
  colouring and scipy removed. Tests: Vitest (`frontend/tests`, 153, `colour.test.ts` new), pytest (129, the data
  tiles in `tests/test_api_mosaics.py`). Release checks passed on Linux (check_dist, twine, smoke, ruff, 131 pytest
  with the flight tests, 153 Vitest, ESLint) and on Windows from WSL (129 pytest from a fresh clone, smoke on 3.12
  and 3.14).
- **B3: the basemaps, release 0.4.0** (2026-10-27). Mapbox's satellite imagery through the Static Tiles API with
  the user's own public token (`analyzer/basemaps.py`: the `mapbox_token` preference, else `MAPBOX_API_TOKEN` from
  the environment or a `.env` file; `PUT /api/preferences` saves and removes it), the switch, the token form with
  how to get one, the wordmark and attribution (`frontend/src/map/basemaps.ts`, `frontend/src/map/mapbox-token.tsx`,
  the wordmark in `static/vendor/mapbox/`), and Esri's layer reading its tilemap to stretch its deepest level instead
  of "Map data not yet available". Tests: `tests/test_basemaps.py` (pytest), `frontend/tests/basemaps.test.tsx`
  (Vitest). The README says how to get a token. The release checks found check_dist refusing the wordmark, fixed on
  its own branch. Release checks passed on Linux (check_dist, twine, smoke on 3.12 and 3.14, ruff, 143 pytest with
  the flight tests, 164 Vitest, ESLint) and on Windows from WSL (141 pytest from a fresh clone, smoke).
- **E1: projects** (2026-10-27). `Project` and each dataset's `project` (`analyzer/models.py`; a dataset saved
  without one goes into the first), the migration making the Default Project and moving the datasets into it
  (`migrations/0003_projects.py`), and `Project.default()` making it again whenever none is left. `/api/projects`
  (list, make, change, delete with the datasets and their folders), a project's disk space and each dataset's flight
  area (the hull of its frames' positions, `thermal_analysis.flight_area`); datasets made in, listed by and moved to
  a project; compare listing the project's conversions first (`analyzer/api.py`). The projects page is the home page
  and a project has its page with the map of its flights and its datasets (`frontend/src/projects/`); the dataset
  page leads back to its project. Tests: `tests/test_api_projects.py` (with the migration), `tests/test_pages.py`,
  `frontend/tests/projects.test.tsx`, `frontend/tests/datasets.test.tsx` (moving a dataset). Checked live in headless
  Chromium on the real data folder (its database backed up first and restored after): the migration, a project
  made, the dataset moved into it and back, its flight area on the map, the breadcrumb, the delete dialog, compare;
  light, dark and 390 px wide; no console errors or failed requests.
- **E2: the location** (2026-10-27). `/api/places` (`?q=` a search, `?lon=&lat=` the address at a point) asking
  OpenStreetMap's Nominatim from the server with the app's user agent, one request a second at most, in the browser's
  language (`analyzer/places.py`, `NOMINATIM_URL` in the settings). On the project's form, the search, its results
  and their credit, the map the point is clicked on, the label edited, and the location cleared
  (`frontend/src/projects/location-field.tsx`, `location-map.tsx`, `places.ts`); the projects page has the basemaps
  for it. Tests: `tests/test_places.py` (a fake Nominatim), `tests/test_pages.py`, `frontend/tests/location.test.tsx`
  (the map stood in for). Checked live in headless Chromium against Nominatim, light, dark and 390 px wide: a search,
  a result picked, a point clicked and named, the project made and shown with its pin, the location cleared, the
  project deleted. No console errors and no failed requests.
- **E3: the navigation pane and preferences** (2026-10-27). `/api/navigation` (projects, their datasets and
  conversions, and which of a conversion's pages are ready), the `locale` preference, `/preferences`, and the flight's
  time zone (`flight_zone` in the dataset, frames and mosaics APIs: the offset between the frames' recorded time and
  their UTC time, `analyzer/thermal_analysis.py`). The pane with the toggle in the header, remembered shown and
  unfolded, the current page marked, an overlay with a backdrop under 768 px, relisted after a change
  (`frontend/src/components/nav-pane.tsx`, `core/navigation.ts`, `core/page.tsx`); User Preferences (unit, theme,
  locale with an example, `frontend/src/preferences/`); dates in the locale and capture times in the flight's zone
  (`core/format.ts`). Tests: `tests/test_navigation.py`, `tests/test_pages.py`, `frontend/tests/navigation.test.tsx`.
  Checked live in headless Chromium on the user's data, light, dark and 390 px wide: the pane, hidden and kept, the
  dataset analyzed again and shown in UTC−5, the locale and theme saved. No console errors and no failed requests.
- **C1: dji-thermal-cli 1.5.0** (2026-10-27). Released there (frame models in the mosaic's sidecar,
  `read_frame_models` and `FrameModels`; its model reproduces the mosaic's own sampling for 99.6% of pixels on the
  220 M4T frames), and pinned here in `pyproject.toml` and `uv.lock`. Test: `tests/test_flight.py` reads a mosaic's
  frame models back and finds its centre in a frame.
- **C2: the source frames pop-out** (2026-10-27). `POST …/mosaics/<tab>/sources` (`analyzer/thermal_sources.py`,
  `MosaicSourcesView` in `analyzer/api.py`): a spot's frames with its pixel in each, or an area's with the share each
  saw, the share the mosaic took from it and the area's outline in its pixels, from the frame models; a mosaic built
  before 1.5.0 lists only the frames it used. The window (`frontend/src/sources/`): moved by its title and kept
  there, ←/→ and Esc, the frame coloured as the mosaic, a list for each mosaic of a difference. On the viewer: a
  Source frames tool, a click on the Source frame tab, and a button under a spot or area measurement; on the compare
  page it replaces the Picked point panel. Tests: `tests/test_api_sources.py`, `tests/test_flight.py`,
  `frontend/tests/sources.test.tsx`. Checked live in headless Chromium, light and dark, on the user's data (one frame
  and the rebuild note) and on a copy with its mosaics rebuilt (42 frames for a spot, 112 for a box, the outline in
  each). No console errors and no failed requests. Released as 0.5.0 with E1–E3 and C1: the release checks found
  check_dist and the smoke check still expecting the datasets page E1 replaced, fixed on their own branch. Release
  checks passed on Linux (check_dist, twine, smoke on 3.12 and 3.14, ruff, 198 pytest with the flight tests, 206
  Vitest, ESLint) and on Windows from WSL (196 pytest from a fresh clone, smoke).
- **F1: live sliders and the scale's ends** (2026-10-27). The viewer, frame and compare pages colour the map from
  the style of a slider being dragged (`dragged` in `viewer-page.tsx` and `frame-page.tsx`, `drawnStyle` in
  `compare-page.tsx`); `ThermalLayer.setColouring` (`map/map.ts`) sets the shader's variables when only the range or
  the sharpening changed, and compiles the style again otherwise. The steps are `SLIDERS` and the scale's labels
  `scaleTicks` (`viewer/view.ts`). Tests: `frontend/tests/view.test.ts` (steps, the scale's ends),
  `viewer.test.tsx` and `compare.test.tsx` (drawn while dragged, kept when let go, no curve asked meanwhile).
  Checked live in headless Chromium on the 220 M4T frames, light and dark: every slider on the three pages redraws
  the map while held, and it is the same once let go; the scales read e.g. 49.2, 80, 100, 125.4; no console errors
  and no failed requests. Released as 0.5.1: release checks passed on Linux (check_dist, twine, smoke on 3.12 and
  3.14, ruff, 198 pytest with the flight tests, 210 Vitest, ESLint) and on Windows from WSL (196 pytest from a fresh
  clone, smoke).
- **C3: findings on the viewer** (2026-10-27). `Finding` on the dataset (`analyzer/models.py`, migration 0004),
  its API under `/api/datasets/<id>/findings` (`analyzer/api.py`: drawn spots and areas measured on the tab shown, or
  a saved measurement copied; the frames from `frame_sources`, shared with the source frames window), and the counts
  and the project's findings list. The viewer's part in `frontend/src/findings/` (helpers, the map layer, the form,
  list and window heading) and `viewer/viewer-page.tsx`; the view in the URL keeps `findings=0`, `hide=` and
  `finding=`. A spot far from a mosaic made a 500, also on `main`: fixed on its own branch (`mosaic_measure` checks
  the shape lands in the mosaic's CRS). Tests: `tests/test_api_findings.py`, `frontend/tests/findings.test.ts`, and
  findings tests in `viewer.test.tsx` and `projects.test.tsx` (214 pytest, 219 Vitest, ESLint and ruff clean).
  Checked live in headless Chromium on the 220 M4T frames, light and dark: a box from the source frames window with
  one frame left out, a saved spot measurement saved as a finding, both drawn and tagged, a click on the map opening
  one, hiding one and the switch in the URL, a change of status, a link opening one, the project page's list and
  the counts, then both deleted; no console errors and no failed requests.
- **C4: findings on the compare page** (2026-10-27). In `compare/compare-page.tsx`: a Drawing on each pane's map
  (Spot and Area, `Toolbar` in its compact form), each pane drawing its datasets' findings (`findings/layer.ts`, with
  `centreOf` shared with the viewer), the findings of the datasets shown loaded once each, the window's per-mosaic
  "Save as finding" (`SourceGroup.about`, `SaveFinding` in `findings/panel.tsx`) and a finding's heading with Change
  and a link to the viewer; the URL keeps `findings=0`, `a_finding=` and `b_finding=` (`compare/compare.ts`). No
  change to the back end. Tests: findings tests in `frontend/tests/compare.test.tsx`, a map click made up through
  `MapBrowserEvent` (223 Vitest, ESLint clean). Checked live in headless Chromium on the 220 M4T frames, light and
  dark: a spot saved from pane A, an area from pane B, a spot from B's mosaic of a difference (saved on conversion 2),
  a click on the map opening one, a change of status, the switch in the URL, a link opening one in pane B and its
  link to the viewer. The pane's tool hint pushed its map down: the toolbar now keeps it as a tooltip. No console
  errors, no failed requests, no findings left. Released as 0.6.0: release checks passed on Linux (check_dist, twine,
  smoke on 3.12 and 3.14, ruff, 216 pytest with the flight tests, 223 Vitest, ESLint) and on Windows from WSL (214
  pytest from a fresh clone, smoke).
- **D1: the dataset report** (2026-10-28, branch `d1-dataset-report`): `/dataset/<id>/report`
  (`views.dataset_report`, `templates/dataset_report.html`, entry `pages/dataset_report.tsx`), the page in
  `frontend/src/report/` (`dataset-report-page.tsx`; the summaries, numbering and defaults in `report.ts`). The text
  is the dataset's `report` field (migration 0005), changed a field at a time with its PATCH (`parse_report` in
  `api.py`; null forgets one) and the last author kept as the preference `report_author`; the dataset's detail adds
  `flight_area`. A Report button on the dataset page and a Report entry under each dataset in the pane. Print styles
  at the end of `app.css`; the dark tokens now apply on screen only, so every page prints light. A setting with more
  than 6 values (reflected and ambient temperatures, measured at each frame) is given as its range. Tests: pytest in
  `test_pages.py`, `test_api_datasets.py` and `test_vite.py` (each page the views serve is one Vite builds: the stub
  manifest had hidden a page named with a hyphen, which Vite skips), 219 passed; Vitest in
  `frontend/tests/report.test.tsx` and the pane's in `navigation.test.tsx`, 237 passed; ESLint and ruff clean.
  Checked live in headless Chromium on dataset 1 (327 frames), light and dark: a temporary finding, the text typed and
  saved, the appendix on, `page.pdf()` to A4 and Letter (the same in both themes) and the print layout looked at;
  fixed from it: the date as large as the title, a setting listing dozens of values, the appendix wider than the page.
  No console errors, no failed requests; the finding deleted and the report's text put back (`{}`). The author was
  not typed live, as the preference cannot be cleared through the API (its saving is covered by pytest).
- **D2: the mosaic report** (2026-10-28, branch `d2-mosaic-report`): `/conversion/<id>/report`
  (`views.conversion_report`, `templates/conversion_report.html`, entry `pages/conversion_report.tsx`).
  - **Page:** `frontend/src/report/conversion-report-page.tsx`, with the view, colouring, close-up extents and
    findings on the mosaic in `mosaic-report.ts`.
  - **Figures:** `figures.ts` draws them off the page with a `ThermalLayer` of its own and makes them into images
    with `snapshot` and `viewCanvas`, one map at a time. The page cannot be printed until they are drawn.
  - **Shared with D1:** `text.tsx` (the text saved as typed, the title block, the bar) and `findings.tsx`.
  - **Server:** the conversion's `report` field (title, author, date, notes, view, left_out; migration 0006),
    changed with its PATCH (`parse_report` with `MOSAIC_REPORT`, the view checked by `report_view`), and the
    measurement's `comment` (its PATCH, the CSV's Comment column, the GeoJSON's property).
  - **Viewer:** a Report button saves the view shown, then opens the report. The pane lists the report under each
    conversion with mosaics. `viewCanvas` gained north and coloured marks.
  - **Tests:** pytest in `test_api_conversions.py`, `test_api_measurements.py`, `test_pages.py` and `test_vite.py`
    (222 passed). Vitest in `frontend/tests/mosaic-report.test.tsx` (its figures mocked: jsdom has no WebGL), the
    viewer's Report button and the pane (247 passed). ESLint and ruff are clean.
  - **Live check:** in headless Chromium on dataset 1's conversion 2, light and dark, with three temporary
    measurements (a line, an area, a spot on a frame) and a finding. The viewer's Report button saved the
    harmonized view, the four figures were drawn, a comment was typed, a measurement left out, and the report
    printed to A4 and Letter and looked at.
  - **Fixed from the live check:** every figure undrawn on the first run (the image is now waited for 10 s and
    asked for again once), and the caption and the profile's hint in the print.
  - **Left as found:** no console errors or failed requests; the measurements and finding deleted, the report's
    text put back (`{}`).
  - **Released as 0.7.0** with D1: release checks passed on Linux (check_dist, twine, smoke on 3.12 and 3.14,
    ruff, 224 pytest with the flight tests, 247 Vitest, ESLint) and on Windows from WSL (222 pytest from a fresh
    clone, smoke).
- **F1: visual mosaics in dji-thermal-cli** (2026-10-27, there: branch `mosaic/visual`, released as dji-thermal-cli
  1.6.0, merged into its `main`, not pushed or tagged). `--mosaic-visual` / `MosaicOptions(visual=True)`
  (`visual.py`; `read_pose(visual=True)`, `_place(r=...)` in `mosaic.py`; RGBA in `tiffout.write_tiff`):
  `mosaic_visual.tif` (red, green, blue, alpha; 8-bit, UTM), its sidecar with the visual frames (each with
  `thermal_file`) and `frame_models` (read by `read_frame_models`), and `mosaic_visual_preview.png` (at most 2048
  px). As the app calls it with `as_converted_dir`, the visual mosaic is written once, in the harmonized folder.
  - **Pairing:** by `UTCAtExposure` within 0.25 s (by content, as the CLI identifies files), else the capture
    number in the same folder. On dataset 1's flight the pairs are 10 to 100 ms apart and the captures at least
    0.57 s, so it agrees with the capture index for all 327.
  - **Placement:** the thermal frame's attitude with the alignment's boresight, its shift, rotation and surface;
    the visual frame's own position and lens (35 mm equivalent: 2795 px on the M4T's wide camera).
  - **The cameras' offset:** each pair's offset is measured by phase correlation of gradient magnitudes on the
    largest square inside the thermal footprint, and solved robustly as one pitch and yaw. On dataset 1's flight
    it was 10 cm before and 2.6 cm after correction (median, 94 pairs), at pitch +0.25° and yaw −0.29°. On the
    CLI's own M4T flight (12 pairs, on Windows) it was +0.28° and −0.31°.
  - **Size:** dataset 1's visual mosaic is 5764×6256 px at 0.6 cm/px and 86 MB, about a minute after the thermal
    mosaic. `--mosaic-visual-gsd` makes it coarser, decoding the JPEGs at 1/2, 1/4 or 1/8 of their size.
  - **Tests:** `tests/test_visual.py`. A synthetic flight whose visual camera is turned 0.4°/−0.3° is recovered
    to 0.05°. Also tested: pairing, posing, the GeoTIFF and frame models, threads, and a flight test of the API
    and CLI. Full suite 905 passed with the CLI's flight and the native SDK; on Windows 218 passed from a fresh
    clone with 12 nadir pairs. The flight tests first assumed the offset is always corrected, which a small
    flight doesn't give; they now follow the report (fixed on `fix/visual-flight-tests`).
- **F2: visual mosaics and frames in the app** (2026-10-28, branch `f2-visual`; dji-thermal-cli pinned at 1.6.0).
  - **Server:** `thermal_mosaics.build` asks for the visual mosaic (the conversion option `visual`, on by default)
    and `build_visual` moves it to `mosaics/visual/`, writes the map's copy `viewer/visual.tif` (`map_copy`: tiled
    512, JPEG YCbCr q90, the alpha as an internal mask, average overviews; 14 MB against 85 MB on dataset 1's
    flight, tiles in 30 to 60 ms) and `viewer/visual_pairs.json` (`visual_pairs`). A stripped conversion writes a
    located copy for these and removes it. API: `mosaics/visual/tiles/z/x/y.png` (`VisualTileView`),
    `frame/visual?frame=&size=` (`FrameVisualView`, re-encoded without metadata), `visual` and `visual_note` in the
    viewer's data, each frame's `visual` pair in `frame` and the sources, and the datasets' `visual` count.
  - **The pairs' homography** (`thermal_mosaics.homography`): a thermal pixel to its visual one, from the two
    sidecars' frame models, through the cameras' rotations and the drone's move between the two exposures onto
    the ground plane. On dataset 1's flight it lands 0.24 visual px from the visual frame model (median, at most
    2.9 px on the roofs); without the move the median was 2.5 px and the maximum 16 px, as the visual image is
    exposed 10 to 100 ms after the thermal one.
  - **Pages:** the viewer's Visual tab (`visualLayer` in `map/map.ts`; the data tab stays as converted, so the
    readout, the source frames and the shapes drawn are its), its report rows (`visualRows`); the source frames
    window's Thermal/Visual switch (`VisualImage`, `toVisual`/`ringToVisual` in `sources/sources.ts`); the frame
    page's switch (`frameImageLayer`; its drawing and readout map through `fromVisual`, and the view keeps the same
    ground); "Visual" in the Files tab, the figures, the datasets list and the convert form's checkbox
    (`fileKind`, `thermal_analysis.VISUAL_NAME`: DJI's `_V`/`_W` names, for what the pages call them only).
  - **Tests:** `tests/test_api_visual.py` (fakes with real frame models in `tests/fakes.py`: the homography against
    `FrameModels.pixels`, the pairs, the build, the map copy, the tiles, the stripped copy, the frame image, the
    download), the flight test of a paired flight (`DJI_THERMAL_FLIGHT_DIR` with `_V` images; skipped without),
    Vitest for the mapping, the window's and frame page's switches, the Visual tab and the rows. Checked live on
    dataset 1, which now holds the flight's 327 `_V` images too (its conversion 1 rebuilt with the visual mosaic,
    92 pairs measured, pitch +0.25° and yaw −0.29°), in light and dark: the tab, the readout, a click's window on
    both cameras, a box drawn and measured on a visual frame, the Files tab and the convert form. No console
    errors and no failed requests.
  - **Also on this branch:** the test of the command retries reading the journal mode while Windows still holds
    the stopped server's database files (it failed now and then on CI's Windows with Python 3.14; merged before as
    `fix-windows-wal-test`).
- **F3: comparing visual and thermal** (2026-10-28, branch `f3-visual-compare`).
  - **Compare page:** the mosaic menu lists each conversion's visual mosaic (`comparable` says `visual`;
    `comparedTabs`, `dataTab` and `VISUAL` in `compare/compare.ts`). A visual pane draws the visual tiles
    (`visualLayer`), reads the as converted values (readout, source frames, a finding's tab), opens its window on
    the visual pairs, has no palette or colour scale, and turns the difference off and keeps it from being chosen.
    "Overlay (A over B)" draws both panes' mosaics in one pane (`drawsOf`/`layersOf` in `compare-page.tsx`, the
    top one faded and cut by `clipLeft` in `map/map.ts`: a scissor on WebGL, a clip on a canvas); opacity and swipe
    are in the URL (`overlay=`, `opacity=`, `swipe=`), and the readout gives A and B without A − B.
  - **Frame page:** the switch is Thermal / Visual / Both (kept as before in localStorage: "1" Visual, "2" Both).
    Both shows the pair in a side pane (`SIDE`) with its own view (`frameView(32)`), which follows the frame's
    through the pair and the reverse (`viewThere`). The shapes and the cursor are drawn on every pane, and the
    PNG export takes the side pane.
  - **Tests:** pytest for `comparable`'s flag; Vitest for the URL, the tabs offered, the visual pane, the overlay's
    layers, opacity, swipe and readout, and Both's pane and its view following. Checked live on dataset 1, light and
    dark: a visual pane beside a thermal one, A over B swiped and faded (a 50% blend is the mean of the two
    pixels), an overlay of two thermal mosaics, the window from a visual pane, Both with a spot measured, zoomed
    and stepped to the next frame, and the PNG export. No console errors and no failed requests.
- **G1: the default port and a wrapper script** (2026-10-28). `cli.py` serves on 8080 by default and stops like
  Ctrl+C on SIGTERM; `dji-thermal-ui.sh` (build, rebuild, start, stop, restart, status, logs; `.run/` for its PID
  file and log). Tests: `tests/test_script.py` (the script in a clone of its own, with stub uv, npm and curl) and
  `tests/test_cli.py`. Checked live from a fresh clone: `start` built it and served on 8080 with no `--port`, then
  restart, logs, rebuild, stop and status.
- **H1: the viewer tidied** (2026-10-28). `viewer/viewer-page.tsx`: Esc or a click on the frame kept lets go of it
  (`readout`'s `kept`); the Source frame tab draws the as converted values with a second `ThermalLayer` of the source
  frame index coloured `seams` (`map/colour.ts`: light and dark where the index changes, in WebGL and on a canvas),
  in the PNG export too; no legend on the viewer's or the frame page's map; Pointer info above Source frames. "Mosaic"
  in `TAB_LABELS` and `TARGET_LABELS`. Tests: `frontend/tests/colour.test.ts` (the seams), `viewer.test.tsx` (letting
  go, the seams layer, the panel's order and scale) and the labels throughout. Checked live on dataset 1 in light and
  dark: the tabs, Esc and a second click letting go (the window left open), the seams at two zooms and in the PNG,
  the frame page without its map scale, and the compare page's scales. No console errors or failed requests.
  - **Then** (2026-10-28): the mosaic report's Source frame figure too: the as converted mosaic coloured as the
    temperatures are, with the seams over it (`underOf` in `report/mosaic-report.ts`, `Source.over` in
    `report/figures.ts`, `SEAMS` in `map/colour.ts`). Test: `frontend/tests/mosaic-report.test.tsx`. Checked live
    on dataset 1's report in light and dark, its saved view put back as it was.
- **I1: the names** (2026-10-28). Every visible string says flight for a `dataset` and dataset for a `conversion`:
  the pages in `frontend/src` (lists, the flight page and its Convert tab, the reports, the viewer, compare, frame,
  findings and preferences), the server's messages (`api.py`, `thermal_*.py`, `views.py`), the command's help, and
  new datasets' default name "Dataset N" (`api.py`). The README calls them so throughout; CLAUDE.md says which name
  is which. Tests: the strings updated in `frontend/tests/` and `tests/`. Checked live on every page: what still says
  otherwise is a name saved before ("Conversion 1") or dji-thermal-cli's own problem text ("dataset median").
- **I2: the navigation** (2026-10-28). Under each dataset, Tools (Compare, Report), Mosaics (each viewer tab, a
  `?tab=` link) and Frames ("In the mosaic" and "Oblique", `frame?list=mosaic|oblique`, with counts; one list for a
  dataset without mosaics). The navigation API gives a built conversion's `tabs`, `in_mosaic` and `oblique` (left out
  for their angle or as unusable) (`nav_conversion` in `api.py`); the pane's items and the marked one are worked out
  in `core/navigation.ts` (`conversionItems`, `trailTo`, `markedItem`), the deepest item seen is marked, and the
  viewer says when its tab changes (`partChanged`). The frame page shows only the list's frames (`listFrames` in
  `frame/frame.ts`) and keeps `list` in its URL; I3 makes it the explorer. The tab labels are in
  `viewer/tab-labels.ts`, so the pane imports no viewer code. Tests: `tests/test_navigation.py`,
  `frontend/tests/navigation.test.tsx`, `frontend/tests/frame.test.tsx`. Checked live on dataset 1: 151 in the
  mosaic and 176 oblique, the viewer's tab followed, the lists stepped through with →.
- **I3: the frames explorer** (2026-10-28). The frame page lists its frames (the pane's list, or all) beside the
  frame, in capture order (`captureOrder` in `frame/frame.ts`), the first shown, as a list or thumbnails (the
  dataset's `thumbnail`, a switch kept in localStorage `thermal-analyzer.frame.thumbnails`), the frame shown kept in
  sight (`frame/frame-list.tsx`); it replaces the frame picker. Each frame says what its list does not
  (`frameTag`): not converted, in the mosaic, oblique above the mosaics' pitch limit (the frames API's `max_pitch`,
  from `thermal_mosaics.max_pitch`, which the mosaics use too) or left out as unusable. Tests:
  `frontend/tests/frame.test.tsx`, `tests/test_api_measurements.py`. Checked live on dataset 1, light and dark: 176
  oblique frames in capture order (all tagged oblique, as the mosaic's report counts them), 151 in the mosaic, ← →
  keeping the frame in sight and the list in the URL, the thumbnails loading as they scroll in and the switch kept
  over a reload, the list above the frame at 700 px; no errors.
- **J1: the Files tab's filters** (2026-10-28). The name search became a list of conditions every row matches
  (`Condition`, `matches`, `fileRows` in `dataset/files.ts`): numbers in the unit shown (= and ≠ at the digits shown),
  text by its words, Kind as checkboxes (`KindPicker` in `dataset/tabs.tsx`, in the Kind header and in a condition),
  and yes/no on two new columns, Thermal frame and With problems (`FLAG_COLUMNS`, the Files tab's columns being
  `FILES_TAB_COLUMNS`; the report's appendix keeps `FILE_COLUMNS`). The three buttons set their filter (`SHOWS`,
  `shownAs`). The filter is in the URL (`?filter=key.op.value`, `filterQuery`/`parseFilters`). Tests:
  `frontend/tests/dataset.test.tsx`. Checked live on flight 1 in °F, light and dark: 654 files, 327 thermal frames,
  177 with problems; Kind without Visual, Height ≤ 21.15 m and Min > 50 °F showing the 34 the data has, kept over a
  reload; Clear back to 654; no overflow at 700 px; no errors.
- **Fix: the Convert tab's settings fold again** (2026-10-28, reported by the user). Edit settings disappeared once
  the form was open; it stays now, as Hide settings, and folds the form away with its values kept
  (`dataset/convert.tsx`). Test: `frontend/tests/dataset.test.tsx`. Checked live on 8080 on flight 1, light and dark,
  nothing sent.
- **Fix: System Settings folds** (2026-10-28, reported by the user: once unfolded it could not be folded again).
  In the pane, System Settings is a button (`nav-settings-toggle`, its name and a chevron) that folds Storage away,
  kept with the pane's other folds (`settings` in its stored keys), and unfolded when the Storage page is shown.
  Test: `frontend/tests/navigation.test.tsx`. Checked live on 8081, light and dark.
- **dji-thermal-cli 1.6.1 pinned** (2026-10-28, published by the push the user asked for): FLIR radiometric JPEGs
  (the XT2's) reported as an unsupported image type. 305 pytest, and the flight tests on the 220 M4T frames.
- **L2: moving the data folder** (2026-10-28). `move.py` (no Django: `inspect` the target, the plan and result
  files in the config folder, `perform` the move: what the target held set aside in `replaced-<date>/`, the files
  renamed on one drive or copied then removed, undone on failure, the pointer written), `datadir.py` (the pointer,
  `chosen`, `DataDirError` for a moved folder missing, `DJI_THERMAL_UI_CONFIG_DIR`), `cli.py` (the plan made before
  `setup`, the import after it, the restart: `execv` on POSIX, a new process on Windows that waits for the old one),
  `analyzer/storage.py` (`check`, `busy`, `import_replaced`: the set-aside database copied, migrated, read through a
  thread's own connection, each project made with `restore.make_project`, extracted from `finish`, whose failure now
  moves files back instead of deleting them), `api/storage/check` and `api/storage/move`, and the page's "Move the
  data folder" (`storage-page.tsx`: `checkText`, `lastMoveText`, `waitForMove`). The app's own empty Default
  Project there is not offered. Tests: `tests/test_move.py` (the command run end to end too), `tests/test_cli.py`,
  `frontend/tests/storage.test.tsx`. Checked live on 8081 with its own config folder (none of the user's data): A
  moved onto B, a data folder with a project of an uploaded and a folder flight, in 2.3 s with the same PID, Barn
  imported with both, the page reloaded, light and dark; then on to a new folder C through the API.
- **L1: the Storage page** (2026-10-28). `analyzer/storage.py` (`measure`: the data folder walked when asked, each
  file the database's, a flight's by `datasets/<id>/`, left behind by a flight no longer there, or other; a folder
  flight's images measured where they are; the drive's free space), `api/storage`, the page `settings/storage`
  (`storage/storage-page.tsx`: `storageRows`, `share`), System Settings › Storage in the pane (`nav-pane.tsx`,
  the `HardDrive` icon). Tests: `tests/test_api_storage.py`, `tests/test_pages.py`, `frontend/tests/storage.test.tsx`,
  `navigation.test.tsx`. Checked live on 8081 on the user's data, light and dark: the total equal to `du -sb` of the
  data folder (2,365,087,602 bytes), the pane's Storage marked, no overflow at 600 px, no errors.
- **Release 0.8.0** (2026-10-28): F2 to K2, the report's seams and the two fixes below (the changelog's two Changed
  sections made one). Release checks passed on Linux (check_dist, twine, smoke on 3.12 and 3.14, ruff, 273 pytest
  with the flight tests, 300 Vitest, ESLint) and on Windows from WSL (264 pytest from a fresh clone, 9 skipped;
  smoke of the final wheel).
- **Fix: New Flight's folder picker and TIFFs** (2026-10-28, reported by the user: "Ability to create new flights
  seems to be completely broken"). "Choose a folder" gave Preact `webkitdirectory: ""`, which it sets as the
  property, false: the input was a file picker, where a folder cannot be chosen; it is `true` now. Files chosen
  with no JPEG among them (the user chose TIFFs) said "Choose the images to upload"; `noImagesText` now says that a
  flight is made of R-JPEGs, as soon as they are chosen and on Create (`datasets/new-dataset.tsx`). Tests:
  `frontend/tests/datasets.test.tsx` (the folder test with the property as browsers have it; both fail on the old
  code). Checked live on 8080: TIFFs by files and by folder told apart, R-JPEGs by files and by folder made flights
  (deleted after).
- **Fix: the Oblique frames list** (2026-10-28, reported by the user). A conversion with a pitch limit does not
  convert its oblique frames, so the Oblique list (converted frames the mosaics left out) was empty and fell back to
  every frame, the mosaic's included. It now lists every frame the mosaics left out, converted or not (tagged
  "oblique, -45°, not converted"), and falls back to all only while the mosaics placed none; "In the mosaic" is
  called "Mosaic" in the pane. `listFrames`, `frameTag` (`frame/frame.ts`), `FRAME_LISTS` (`core/navigation.ts`).
  Tests: `frontend/tests/frame.test.tsx`, `navigation.test.tsx`. Checked live on both datasets of flight 1:
  Mosaic 151 and Oblique 176 each, as a list and as thumbnails.
- **K2: import a project** (2026-10-28). `analyzer/restore.py`: the archive sent in pieces of 16 MB (waitress takes
  1 GB a request at most) to `api/imports` (`POST` {size}, refused without the room; `PUT ?offset=` each piece, one
  sent again read from where the last stopped, 409 for a gap; `POST` {name} finishes; `DELETE` stops). Each piece is
  unpacked as it comes by a tar reader of its own (tarfile's header parser, PAX and GNU long names) into
  `imports/<id>/`; the manifest, first, is checked (format, version, rows) and summed up with a free name
  (`free_name`). A file outside the manifest's flights, a path leaving its folder, a link or a damaged tar is refused
  and the folder removed. Finishing makes the rows with new ids in one transaction (`full_clean` on each), remaps the
  links and a mosaic report's `left_out` and `view.hidden`, makes folder flights uploaded and running jobs canceled,
  and renames the folders into place. `clear_imports` at the server's start. The export now keeps dates to the
  microsecond. The Import dialog (`projects/import-dialog.tsx`, `sendArchive`). Tests: `tests/test_api_import.py`,
  `frontend/tests/projects.test.tsx`. Checked live on project 1 (on 8081), light and dark: the 2.2 GB archive's
  project known in 0.15 s with "Default Project (2)" proposed, a name in use refused, received in 13 s, imported in
  0.1 s; its images and both datasets' outputs identical to flight 1's, its rows the same; the copy's viewer showed
  its mosaic; no overflow at 700 px; no errors; both copies deleted.
- **K1: export a project** (2026-10-28). `analyzer/backup.py`: the tar written by hand (PAX headers, its length
  known beforehand) as `manifest.json` then each flight's files; a folder flight's JPEGs as dji-thermal-cli's scan
  finds them. `api/projects/<id>/export` lists each flight's bytes (or busy), `export.tar?flights=<ids>` streams it
  (409 for a busy flight). The Export dialog (`projects/export-dialog.tsx`) on the project page. Tests:
  `tests/test_api_export.py`, `frontend/tests/projects.test.tsx`. Checked live on project 1 (on 8081), light and
  dark: 2.2 GB listed, downloaded in 16 s at the length announced, GNU tar listed 1634 entries (manifest, 654
  images, 979 outputs) and extracted identical to the data folder; no overflow at 700 px; the archive deleted.
- **J2: favourite filters** (2026-10-28). The Files tab's Favourites menu (`Favourites` in `dataset/tabs.tsx`): the
  filter shown saved under a new name, a favourite chosen in place of the filter (marked while the filter is its own),
  and deleted once asked. They are shared by every flight, in `Preferences` under `file_filters` as the link's
  `key.op.value` conditions (`filtersFrom` in `dataset/files.ts`), through `api/file-filters` (`FileFiltersView`,
  409 for a name in use). Tests: `tests/test_api_file_filters.py`, `frontend/tests/dataset.test.tsx`. Checked live on
  flight 1 (on 8081), light and dark: saved, refused under the same name, listed after a reload, chosen (67 files,
  its link), deleted; the menu kept inside the page at 700 px; none left behind.
- **I1: the preferred palette** (2026-10-29). `palette` in `Preferences` (`PALETTE_KEY`, `palette_choices()` and
  `app_palette()` in `api.py`), offered and saved through `api/preferences`; `default_palette()` starts from it where
  the conversion has it. The "Palette" select is on the preferences page (`preferences/preferences-page.tsx`). Tests:
  `tests/test_api_mosaics.py`, `frontend/tests/navigation.test.tsx`. Checked live on 8081: the viewer, frame
  explorer and compare page opened in magma, a link's palette still won, and the preferences were put back as found.
- **I2: a preview of the preferred palette** (2026-10-29). A made-up roof (`previewScene()` in
  `preferences/palette-preview.tsx`) coloured by `colourValues()` in the palette chosen, with its scale, under the
  "Palette" select; "As each flight's images" shows the newest flight's own. `api/preferences` gives each palette's
  colour map and `images_palette` (`palette_previews()` and `images_palette()` in `api.py`). Tests:
  `tests/test_api_mosaics.py`, `frontend/tests/navigation.test.tsx`. Checked live on 8081 in light, dark and at
  380px: ironred, magma and whitehot drawn, no errors; the preferences put back as found.
- **N1: the preferred basemap** (2026-10-29). `basemap` in `Preferences` (`BASEMAP_KEY`, `basemap_choices()`,
  `preferred_basemap()` and `starting_basemap()` in `analyzer/basemaps.py`; each basemap's `key` in `BASEMAPS`),
  offered and saved through `api/preferences`; `page_basemaps()` marks it as the `default` and the settings' default
  as the `fallback` a refused Mapbox goes back to (`addBasemaps()` in `map/basemaps.ts`). The "Map" select is on the
  preferences page. Tests: `tests/test_basemaps.py`, `frontend/tests/basemaps.test.tsx`,
  `frontend/tests/navigation.test.tsx`. Checked live on 8081, light and dark: the viewer, both compare maps and a
  project map opened on OpenStreetMap, Mapbox (wordmark shown, tiles from Mapbox) and none; the preference was
  removed afterwards.
- **N2: the Mapbox token in System Settings** (2026-10-29). `analyzer/basemaps.py`: `mapbox_token()` reads the
  environment, then the `.env` files; `check_token()` asks Mapbox for tile `0/0/0`; `write_token()` replaces the
  `MAPBOX_API_TOKEN` line of the file it was read from (else the data folder's, mode 600); `move_saved_token()` at
  the server's start (`cli.py`). `api/settings/mapbox` (`MapboxTokenView`); the page `/settings`
  (`settings/settings-page.tsx`), linked from the navigation pane; the switch's token entry and
  `map/mapbox-token.tsx` removed. Tests: `tests/test_basemaps.py`, `frontend/tests/settings.test.tsx`,
  `frontend/tests/basemaps.test.tsx`, `frontend/tests/navigation.test.tsx`. Checked live on 8081 started outside the
  repository with a temporary data folder, light and dark: a wrong token refused by Mapbox (401) with the file left
  as it was; the user's token accepted and written (mode 600), written again in place; a project map then listing
  Mapbox Satellite and showing its tiles (200) and wordmark; no overflow at 380px; the temporary folder deleted.
- **M1: R-JPEG copies in dji-thermal-cli 1.8.0** (2026-10-29, merged there with `release/1.8.0`, published to PyPI the
  same day and pinned here; its `rjpeg` output is kept off the Convert tab until M2). `rjpeg.py`: `copy(data, params, private, picture)`, every edit in place (parameters for iirp, girp and
  hirp; dirp refused with the reason), the private removals and the serials (debug, padding and calibration
  blocks), a new picture and MPF preview with the MPF index rewritten; `privacy.py` also removes the free-text
  fields and the EXIF debug serial (for `--strip-location` too); the `rjpeg` product of `process` with
  `--rjpeg-picture palette|original`, refused for normalized or replaced temperatures; `rjpeg_copy()` and
  `RJpegCopyError` in the API (what M2 uses). Tests: `tests/test_rjpeg.py` (every sample: the port and the native
  SDK measure each copy as the source with the same parameters set; no identifier left; the layout kept; the
  picture shown in both frames; the CLI and the API on the flight). The whole suite passed with the SDK and the
  user's M4T flight on Python 3.14 (locked) and 3.9 (lowest dependencies), after leaving `rjpeg` out of the
  pixel-product test and working around Pillow 11.3 not loading an MPO frame of another size after the first (DJI's
  own files too). Release checks: the build, `check_dist`, twine, and the installed wheel writing private R-JPEGs.
- **The full set on macOS** (2026-10-29, macOS 26.6 arm64, Node 25, uv 0.12). `test_the_server_serves_the_home_page`
  failed at teardown every time: the test closed the server while waitress' loop was in `select` on its sockets
  (EBADF). It now closes the server in the loop's own thread (`pull_trigger(server.close)`) and joins it; the command
  was not affected (it closes the server after `run` returns). Then: 322 pytest (3 flight tests skipped), ruff, 326
  Vitest, ESLint, the build, check_dist, twine and the smoke check of the wheel. dji-thermal-cli 1.8.0 on macOS: 194
  passed, 122 skipped (no SDK samples or flight here), ruff clean.
- **M2: the exports on the server** (2026-10-29, branch `m2-exports`). `analyzer/colouring.py` (the browser's
  `colourValues` in Python, byte for byte, in strips with the unsharp mask's margin; both checked against
  `tests/fixtures/colouring.json`, which `UPDATE_COLOURING_FIXTURE=1` makes again from the browser's), `exports.py`
  (what is asked, checked and kept an hour; a frame as Original, TIFF through dji-thermal-cli's `process_file`, PNG or
  R-JPEG through `rjpeg_copy`, each private too; a zip made as it is sent with `export-notes.txt` for frames that can't
  be made; a shared range and equalization from every 8th pixel of the frames; a mosaic's GeoTIFF, a private copy
  kept in `viewer/private/`, a full-size PNG streamed in strips), `api.py` (`FramesExportView`, `MosaicExportView`,
  `ExportDownloadView`), the Convert tab's `rjpeg` output with `rjpeg_picture`. Tests: `tests/test_colouring.py`,
  `tests/test_api_exports.py` (a flight test on real frames), `frontend/tests/colour.test.ts`,
  `frontend/tests/dataset.test.tsx`. Checked live on 8081 with dataset 1: every format for 1 and 3 frames (0.1–0.75
  s), the mosaics' PNGs (the 5746 × 6240 visual one in 4 s) and private GeoTIFF, the images looked at; the private
  copy removed after.
- **M3: the export dialog** (2026-10-29, branch `m3-export-dialog`). `components/export-dialog.tsx` (the formats
  with what each is for, the options under them, Export: POST then an `<a download>` of the `url`), `core/exports.ts`
  (the formats, `cannotCarry`, the view asked, `startExport`), `frame/export.tsx`, `dataset/export.tsx` (the frames
  shown or all, the dataset or the frames' own values, a palette and a shared range typed in the user's unit and sent
  in the frames'), `viewer/export.tsx`; an "Export…" button on the three pages. Tests:
  `frontend/tests/exports.test.tsx`, and a test on each page (`dataset`, `frame`, `viewer`). Checked live on 8081
  with dataset 1, light and dark: a PNG, an Original (Private) and a zip of 9 TIFFs from the Files tab (R-JPEG and
  Original off for the normalized dataset), an R-JPEG from the frame explorer with the emissivity changed (it reads
  back 0.9), a PNG as converted, and the harmonized mosaic's PNG from the viewer.
- **S: search** (2026-10-29, branch `s1-search`). S1: one matcher, `core/search.ts` (`searchWords`, `matchesText`,
  `matchesSearch`: every word, any order, any case), used by the Projects and flights searches and the Files tab's
  text conditions; `components/search-box.tsx` (Escape empties it); the pane's project filter under Projects
  (`components/nav-pane.tsx`, kept in `localStorage` as `thermal-analyzer.nav.search`). S2:
  `components/section-filter.tsx` on User Preferences and System Settings, matching each `fieldset.preference` on
  its whole text (title, labels, help, choices), again when its content loads. Tests: `navigation.test.tsx` (the
  pane, the preferences page), `settings.test.tsx`, `datasets.test.tsx` (`matchesText`). Checked live on 8081,
  light and dark.
- **Fix: the Mapbox tests on Windows** (2026-10-29, branch `fix-windows-modes`, found by 0.9.0's Windows check). Two
  tests in `tests/test_basemaps.py` checked the `.env` file's Unix mode (0o600, 0o640 kept), which Windows has not:
  they failed there since the Mapbox token moved to System Settings. They check the mode only where files have one
  (`POSIX`). 348 passed on Windows, 10 skipped.
- **Release 0.9.0** (2026-10-29): M (the exports, dji-thermal-cli 1.8.0) and S (search), with the fix above (the
  changelog's two Added and two Changed sections made one). Release checks passed on Linux (check_dist, twine, smoke
  on 3.12 and 3.14, ruff, 358 pytest with the flight tests, 360 Vitest, ESLint) and on Windows from WSL (348 pytest
  from a fresh clone, 10 skipped; smoke of the wheel).
- **ODM1: System Settings › WebODM** (2026-10-29). `analyzer/envfile.py` reads and writes the `.env` values for
  Mapbox and WebODM (the setting `ENV_FILES`, was `MAPBOX_ENV_FILES`; a value that isn't plain is quoted; a file left
  as it was is not written). `analyzer/webodm.py`: the address and login from the environment or `.env`, the client
  (a JWT asked for when needed, kept in memory, asked again when refused or within 5 minutes of expiring; no
  redirects followed; a timeout on every call; errors in plain words) and `check`, `save`, `remove`. The API
  `settings/webodm` (GET masked, PUT checked with a login first, an empty user name or password keeping the saved
  one, DELETE; 409 for the environment's) and `settings/webodm/check`. The page: `frontend/src/settings/webodm-settings.tsx`
  (the nodes the account sees, a warning when none, the permissions list). Tests: `tests/test_webodm.py` (a fake
  WebODM), `frontend/tests/webodm-settings.test.tsx`. Live check against the user's WebODM on 8001 (admin): a wrong
  password refused, saved, checked after a reload, removed, light and dark. The check with an account holding only
  the listed permissions is left for ODM2, where they are used.
- **ODM2: Process in WebODM** (2026-10-29, branch `odm2-process-in-webodm`). `analyzer/webodm_tasks.py`: the
  plugin's checks and plan options, the TIFFs (a name two subfolders share keeps its folders), the upload job
  (project made when asked, task made `partial`, batches of at most 50 files or 32 MB, commit), a half-made task and
  the project the upload made removed when it doesn't finish (`half_made`, retried at start by `remove_half_made`),
  following a task at most every 5 s (`refresh`), a task gone from WebODM marked `gone`. `analyzer/webodm.py`:
  projects, nodes, options, presets (save or change), create, upload (multipart), commit, remove, a task's status;
  `WebODMError.status`. `analyzer/jobs.py`: a second worker, `jobs.UPLOADS`. The model `WebODMTask` (migration
  0007), listed on the conversion (`webodm_tasks`); the API `conversions/<id>/webodm` (GET, POST),
  `webodm/projects`, `webodm/choices`, `webodm/presets`, `webodm-tasks/<id>` (GET follows, DELETE takes it off the
  list) and `.../cancel`; the preset last applied in the preferences (`webodm_preset`). The page:
  `frontend/src/dataset/webodm.ts` (typed options, presets applied), `webodm-panel.tsx` (the panel and the task
  lines), the card's menu (`convert.tsx`), the dataset page polling while an upload runs. Tests:
  `tests/test_webodm_tasks.py` (a fake WebODM keeping projects, tasks and presets; the upload on its own worker,
  canceled part way), `frontend/tests/webodm.test.tsx`, `dataset.test.tsx`. Live check on 8081 against the user's
  WebODM on 8001 as `thermaltest` (Default group and the node's object permission only): 60 TIFFs of m4t-220
  uploaded into a new project with the plan's options and two more, kept as a preset, processed to Completed and
  followed on the card; a second upload canceled, its task removed from WebODM; light and dark. Then the project and
  the preset removed from WebODM. The account needed nothing beyond the listed permissions.
- **ODM3: ODM's orthophoto back** (2026-10-29, branch `odm3-orthophoto-back`). `analyzer/webodm.py`: a task's
  result downloaded as it comes (`download`). `analyzer/webodm_tasks.py`: the download job on `jobs.UPLOADS`
  (`fetch`, `run_orthophoto`, cancel, a download a closed server left marked failed), one orthophoto per conversion
  (another task's replaces it; removed with its task's line or from the card). `analyzer/thermal_mosaics.py`:
  `orthophoto` writes WebODM's (°C and its alpha) in the mosaics' layout in the conversion's unit, with overviews;
  `kinds(conversion)` adds it as the kind `webodm` beside the built mosaics (kept apart in
  `ThermalConversion.orthophoto`, so rebuilding them keeps it), the tab `webodm` in `TABS`, `tab_raster` takes the
  conversion. Measured, compared and made a finding on as a mosaic; its spots and areas say it records no frames
  (`not_recorded`). Migration 0008; a restore keeps the orthophoto without its task's link. The API
  `webodm-tasks/<id>/orthophoto` (POST, DELETE cancels) and `conversions/<id>/orthophoto` (DELETE). The page: the
  task line's **Bring the orthophoto here** with its progress (`webodm-panel.tsx`), the card's note and Remove
  (`convert.tsx`), the WebODM tab named and taken as a temperature tab. Tests: `tests/test_webodm_tasks.py` (the
  fake WebODM serves results), `frontend/tests/webodm.test.tsx`, `dataset.test.tsx`, `sources.test.tsx`. Checked
  first against the user's WebODM: its orthophoto of the TIFFs keeps the temperatures (float32 °C and an alpha
  band). Live check on 8081 as `thermaltest`: 60 frames of m4t-220 converted, processed in WebODM to Completed,
  the orthophoto brought back from the card, shown on the viewer's WebODM tab (temperatures under the pointer), on
  the compare page beside the mosaic, a spot picked on it, then removed from the card; light and dark, no console
  errors. Then the WebODM projects removed.
- **CLI2: dji-thermal-cli 1.9.1** (2026-10-30). Pinned in `pyproject.toml` and `uv.lock` (was 1.8.0): it reads a
  DSM, ODM's `dsm.tif` included, with no TIFF library, ready for ODM4; 1.9.0's DJI SDK option comes with it, unused.
  The full suite with the m4t-220 flight, the release checks and the wheel's smoke check pass on it.
- **ODM4: WebODM's DSM under the mosaics** (2026-10-30). Brought back from a completed task that asked for it
  (`webodm_tasks.run_download`, shared with the orthophoto; `WebODMTask.dsm_*`, `ThermalConversion.dsm`, migration
  0009), kept as WebODM wrote it once dji-thermal-cli has read it; used by `thermal_mosaics.build` with its height
  cell; `ConversionDsmView` (PATCH use/height_cell, DELETE), `WebODMDsmView`. Pages: the panel's "Make a DSM"
  (`withDsm` in `dataset/webodm.ts`), the task line's "Bring the DSM here", the card's `DsmLine` (`dataset/convert.tsx`).
  Tests: `tests/test_webodm_tasks.py` (the DSM's three), `tests/test_api_import.py`, `frontend/tests/webodm.test.tsx`,
  `frontend/tests/dataset.test.tsx`. Live check: 70 frames of m4t-220 processed in WebODM with a DSM, brought back,
  the mosaics rebuilt on it (heights "DSM", 67 rangefinder anchors, 16 px ≈ 21 cm).
- **ODM5: WebODM's DSM on the viewer** (2026-10-30). The DSM's copy for the viewer, heights above its lowest ground
  (`thermal_mosaics.heights`, written by `webodm_tasks.made_dsm`), the Heights tab kept apart from the temperature
  tabs (`thermal_mosaics.HEIGHTS`, `temperatures`, `tab_stats`), the ground's height in `api.mosaic_point` and in a
  measurement (`thermal_measure.ground_heights`). Pages: the tab's unit and caption (`valueUnit`, `valueCaption` in
  `viewer/view.ts`), the readout's "Ground height" (`heightRow` in `viewer/panel.tsx`), a measure's height rows
  (`resultRows`), and the report of what WebODM brought back (`webodmRows`, which also fixed the WebODM tab's
  "undefined placed"). Tests: `tests/test_webodm_tasks.py` (the Heights tab's), `frontend/tests/view.test.ts`,
  `panel.test.tsx`, `viewer.test.tsx`. Live check: 70 frames of m4t-220 processed in WebODM with a DSM, brought back:
  the Heights tab -0.3 to 7.3 m above 212.1 m, the ground's height in the readout on both tabs, a spot's and a box's
  heights, light and dark, no errors. Then the WebODM project removed.
- **V1: videos in a flight** (2026-10-30). `analyzer/video.py` reads a DJI MP4 in plain Python: its info (length,
  frames, fps, size, start in UTC, drone and serial), the `DJI meta` track (a point per frame: time, position, height
  above take-off and absolute, gimbal pitch and yaw, heading, speed; protobuf's left-out zeros read as zeros) and the
  cover JPEG. The analysis lists each MP4 as a `video` row (`thermal_analysis.video_row`), or why it can't be read;
  the upload takes `.mp4`; `api.py` serves `datasets/<id>/video` (in ranges, for seeking), `video-cover` and
  `video-track`, and the thumbnail of a video is its cover; a project's export carries videos (`backup.image_files`).
  The Videos tab (`frontend/src/dataset/video-tab.tsx`, helpers in `videos.ts`): the list, the player beside a map of
  the track and the flight's frames, the marker following `requestVideoFrameCallback` (else `timeupdate`), a click
  within 12 px of the track seeking, the readout. The flight page now loads `ol/ol.css` and the basemaps. Tests:
  `tests/test_video.py` (a fake DJI MP4 built in `tests/fakes.py`), `tests/test_api_export.py`,
  `frontend/tests/videos.test.tsx`. Checked live on 8081 with 6 frames of m4t-220 and the M4T's video uploaded
  through the page: the analysis, the Files row, the list, playback, the readout following, a seek, a click on the
  track (to 0:23.80) and one beside it (nothing), light and dark, no console or HTTP errors. Playwright's Chromium
  plays H.264.
- **V2: analysing a video in the browser** (2026-10-30): the frame shown turned back into levels through the M4T's
  Ironbow (`frontend/src/dataset/ironbow.ts`, taken with dji-thermal-cli's port from an m4t-220 still; the lookup cube
  and the Auto range in `video-levels.ts`) and coloured with `colourValues` on a canvas over the video, behind an
  Original/Recoloured switch, with the viewer's `Controls`, `ImageControls` and `Isotherm` (levels as a value kind
  in `viewer/view.ts`). Stepping, speeds, the loop and the keys in `video-tab.tsx` (helpers in `videos.ts`); frame
  numbers allow for the browser's frame times given to the microsecond. `colourValues` writes its pixels directly
  and sharpens without closures (7 and 50 ms a 640×512 frame, from 34 and 112). Tests: `frontend/tests/videos.test.tsx`.
  Checked live on 8081 (6 frames of m4t-220 and the M4T's video uploaded): stepping by buttons and keys, ⅛× moving
  0.25 s in 2 s, a 10–11 s loop at 2× staying inside it, recoloured as filmed a mean 4.8 RGB units from the video,
  the level under the pointer, Gray with Auto, sharpening, an isotherm, playing recoloured, light and dark, no
  console or HTTP errors.
- **V3: frames kept** (2026-10-30): `VideoFrame` (migration `0010_video_frames`; its two PNGs in
  `datasets/<id>/video-frames/<key>.png` and `<key>-original.png`, removed with it), the API's `video-frames`
  views in `api.py` (the track's point found at the frame's time, the PNGs checked with Pillow), export and import
  (`backup.py`, `restore.py`; format version 2, a finding's link remapped). The Videos tab saves from the button
  or S, lists them under the video (`video-tab.tsx`, helpers in `dataset/video-frames.ts`); the flight report's
  Video frames section and map markers, and a finding's attached frames in both reports (`report/findings.tsx`).
  Tests: `tests/test_video_frames.py`, `frontend/tests/videos.test.tsx`, `frontend/tests/report.test.tsx`.
  Checked live on 8081 (6 frames of m4t-220 and the M4T's video, a finding added in the database): one frame
  saved as filmed (its picture the original byte for byte), one recoloured in Gray with Auto (a different
  picture), renamed, described, attached, opened again as it was shown, the report's section and map, the print
  at A4's width, deleted from the list (their folder gone), light and dark, no console or HTTP errors. The check
  found the notes wiped while typed when a rename's answer drew the list again: fixed, and tested.
- **P1: the visual photos' properties** (2026-10-31): dji-thermal-cli 1.11.0's `check()` describes a drone's visual
  photo in `FileReport.visual` (`listing.describe_visual`, `checks.inspect`; tests in its `tests/test_checks.py`),
  merged there and awaiting the user's push and `v1.11.0` tag; `thermal_analysis.file_row` fills the Files row from
  it (the Distance cell then the rangefinder's alone). The flight report's `visual` switch (`DATASET_REPORT` in
  `api.py`, `report/dataset-report-page.tsx`, `visualPositions` in `report/report.ts`) and the frame page's
  locator switch (`visual_photos` in `FramesView`, `frame/frame-page.tsx`) draw them as hollow orange squares over
  the frames. Tests: `tests/test_api_datasets.py`, `tests/test_api_measurements.py`, `frontend/tests/report.test.tsx`,
  `frontend/tests/frame.test.tsx`, `frontend/tests/dataset.test.tsx`. Checked live on 8081 (a scratch venv with the
  local 1.11.0; 8 pairs of `ignored/m4t-tv` uploaded, analyzed and converted): the visual rows' time, height, pitch
  and rangefinder, the report's layer on, saved, printed light without its switch, then off; the locator's layer on,
  kept over a reload, then off; light and dark, no console or HTTP errors. The check found the filled markers hidden
  under their thermal frames' points and the Distance cell starting with "/": both fixed.
- **P2: Hover for detail** (2026-10-31): the Files tab's pane (`DetailPane`, `Notes` and the hover, selection and
  close state in `FilesTab`, `dataset/tabs.tsx`; `.files-detail` in `app.css`, over the list under 900 px) and the
  thumbnail view's `?size=preview` (1280 px, `PREVIEW_SIZE` in `api.py`). Tests: `tests/test_api_datasets.py`,
  `frontend/tests/dataset.test.tsx`. Checked live on 8081 (8 pairs of `ignored/m4t-tv`, scratch data and config):
  hovering names and thumbnails (a preview in about 80 ms), closing, selecting, Escape, the box off and remembered,
  700 px wide; light and dark, no console or HTTP errors.
- **CLI3: dji-thermal-cli 1.11.0** (2026-10-31). Pinned in `pyproject.toml` and `uv.lock` (was 1.9.1; 1.11.0 published
  by the user's request the same day). The full suite with the flight tests (`ignored/m4t-tv`) passed in a scratch
  environment, leaving `.venv` to the user's running instance; checked live on 8081: a flight's visual rows and
  the detail pane show their time, height, pitch and rangefinder distance.
- **P3: the pane's full size image and the preferred palette** (2026-10-31): `thermal_picture()` and the thumbnail
  view's `?palette=` and `?size=full` (the file as it is, MPO too, for a picture not recoloured) in `api.py`;
  `FullSize` (`dataset/full-size.tsx`, `.full-size` in `app.css`), the pane's Full size button and `pictureOf()` in
  `FilesTab` (`dataset/tabs.tsx`); the preference reaches the page as `data-palette` (`dataset_page`). Tests:
  `tests/test_api_datasets.py`, `tests/test_pages.py`, `frontend/tests/dataset.test.tsx`. Checked live on 8081 (10
  frames of `ignored/m4t-220` and 3 visual photos of `ignored/m4t-rgb`, scratch data and config): DJI ironred in
  light and magma in dark on the thumbnails, pane and full size; fit, 1:1, wheel, drag and Escape; a visual photo at
  4032 × 3024; 600 px wide; thumbnails at most 420 ms; no console or HTTP errors.
- **U1: the usability review** (2026-10-31). A first-time user's tasks walked through on the user's 8080 instance
  (light, dark, 600 px), with what it created deleted and the database checked against a copy taken before. Fifteen
  ranked findings, listed under Usability, written up in a private artifact. Nothing built.
- **U2: the flight page's path from the analysis to a dataset** (2026-10-31; U1's findings 1, 4 and 11). The Convert
  tab is Datasets: the datasets first, then the New dataset bar (chips, name, Convert), the settings folded under
  Change settings, the page opening on it once there is a dataset (`#convert` still opens it); "Next: make a
  dataset" after the analysis; the outputs named for what they are for (`OUTPUT_NAMES`); no tabs while the first
  analysis runs, "Reading the images: n% of N files read", "Cancel the analysis". Code in
  `frontend/src/dataset/dataset-page.tsx` and `convert.tsx`; tests in `frontend/tests/dataset.test.tsx`. Checked on
  the user's data on a scratch 8081 instance (reading only; no datasets and analysing stubbed in the browser), light,
  dark and 600 px, no errors.
- **U3: the Problems tab** (2026-10-31; U1's finding 2). Each of dji-thermal-cli's codes in the app's words, its
  numbers from the files' rows in the preferred unit (`describeProblem`), the files listed once with their values,
  the code in the badge's tooltip; a button for a problem a setting fixes (normalize, one emissivity or humidity,
  the embedded or one fixed distance, the oblique frames when too few nadir frames are left) opens the New dataset
  form with it set (`FixRequest`), converting nothing; unknown codes keep the cli's text; the report the same,
  without buttons. Code in `frontend/src/dataset/problems.ts`, `tabs.tsx` (`ProblemsTab`), `convert.tsx` and
  `dataset-page.tsx`; tests in `frontend/tests/problems.test.ts`, `dataset.test.tsx` and `report.test.tsx`. Checked
  on the user's flights 1 and 8 on a scratch 8081 instance (reading only), light, dark and 600 px, no errors.
- **U4: the viewer's first view** (2026-10-31; U1's finding 3). Without a tab in the link, the viewer opens on
  Harmonized when the as converted mosaic's frame offsets span more than 3 °C over their middle 90% (`disagreement`,
  `DISAGREE_C`), with a notice saying why that can be closed; each tab has a tooltip (`TAB_TIPS`). Code in
  `frontend/src/viewer/view.ts` and `viewer-page.tsx`; tests in `frontend/tests/view.test.ts` and `viewer.test.tsx`.
  Checked on the user's dataset 2 on a scratch 8081 instance (reading only): it stays on Mosaic (span 1.6 °C); with
  the offsets made larger in the browser, it opens on Harmonized with the notice, light, dark and 600 px, no errors.
- **U5: measuring in the viewer** (2026-10-31; U1's findings 5 and 6). One set of drawing tools on the map's top
  edge (`Toolbar` in `frontend/src/measure/result.tsx`), a shape's temperatures in a card on the map
  (`MeasureCard`: Keep as finding, Save measurement, Source frames), the side panel under headings (`PanelGroup`, and
  `Section`'s `folded`, its state now kept as open or folded per section in `frontend/src/viewer/panel.tsx`). The
  viewer (`viewer-page.tsx`), the frames explorer (`frame/frame-page.tsx`) and the compare page's panes
  (`compare/compare-page.tsx`); styles in `app.css` (`.map-stage`, `.map-tools`, `.measure-card`, `.panel-group`).
  Tests in `frontend/tests/viewer.test.tsx`, `frame.test.tsx`, `compare.test.tsx` and `panel.test.tsx`. Checked on
  the user's dataset 2 on a scratch 8081 instance (only GETs and the read-only measure and sources POSTs let through):
  a box and a line measured in the card, Keep as finding's form with the frames beside it (cancelled), Esc, the
  Source frame tab's four tools, the frames explorer's card and compare's tools, light, dark and 600 px, no errors.
- **U6: names** (2026-10-31; U1's findings 7, 8 and 9). The reports labelled Flight report and Mosaic report
  (`dataset/dataset-page.tsx`, `viewer/viewer-page.tsx`, `core/navigation.ts`, `components/nav-pane.tsx`, the report
  pages' titles and `analyzer/views.py`); a dataset's default name from its settings (`defaultName` in
  `frontend/src/dataset/settings.ts`, the placeholder and the name sent in `dataset/convert.tsx`); the New thermal
  flight dialog without the in-place folder (`datasets/new-dataset.tsx`). Tests in `frontend/tests/dataset.test.tsx`,
  `datasets.test.tsx`, `navigation.test.tsx` and `tests/test_pages.py`. Checked on the user's data on a scratch 8081
  instance (GETs only): both buttons and titles, the placeholder following the settings, the dialog, light and dark.
- **U7: the navigation pane and the settings pages** (2026-10-31; U1's findings 10 and 14). The pane down to
  projects, flights and datasets, what it unfolds kept, Storage a row beside User Preferences and System Settings
  (`components/nav-pane.tsx`, `core/navigation.ts`, `nav_conversion` in `analyzer/api.py`); the frames explorer's
  own list switch (`FRAME_LISTS` in `frame/frame.ts`, `frame/frame-list.tsx`, `frame/frame-page.tsx`); the Storage
  page in the settings pages' column (`styles/app.css`). Tests in `frontend/tests/navigation.test.tsx`,
  `frame.test.tsx` and `tests/test_navigation.py`. Checked on the user's data on a scratch 8081 instance (GETs
  only): the pane on the viewer, frames explorer, Flight report and Storage pages, the list switch and its URL,
  light and dark.
- **U8: polish** (2026-10-31; U1's findings 12, 13 and 15). The Files tab's Problems column, Thermal frame and Notes
  gone (`FLAG_COLUMNS` and `filtersFrom` in `dataset/files.ts`, `shortName` in `dataset/problems.ts`,
  `dataset/tabs.tsx`); menus' links styled as their buttons and the shared `useMenu` (`components/menu.ts`); the
  Flights table's row menu (`datasets/datasets-page.tsx`), 0 counted on the Projects table; Compare's `Toggle`
  (`compare/compare-page.tsx`); the basemap list's colours (`styles/app.css`); the reports' saving status
  (`report/text.tsx`). Tests in `frontend/tests/dataset.test.tsx`, `datasets.test.tsx`, `projects.test.tsx`,
  `compare.test.tsx`, `report.test.tsx` and `mosaic-report.test.tsx`. Checked on the user's data on a scratch 8081
  instance (GETs only), light and dark: the Problems column (every row 30 px), an old `thermal_frame` link, both
  menus, the toggles, the basemap list, both reports' bars.
- **S1: the WebODM password encrypted in `.env`** (2026-10-31). Fernet from `cryptography` 50.0.2
  (`analyzer/encryption.py`), its key in the `EncryptionKey` table (migration `0011_encryption_key`); written by
  `webodm.save`, read by `webodm.config` (unreadable when the key can't open it), plain ones encrypted at start-up
  (`webodm.encrypt_saved_password`, called in `cli.make_server`), the key deleted by Remove. System Settings › WebODM
  says when the saved password can't be read, and its Save asks only for the missing parts of the login
  (`settings/webodm-settings.tsx`). Tests in `tests/test_webodm.py` and `frontend/tests/webodm-settings.test.tsx`.
  Checked on a scratch 8081 instance (scratch data and start folders) against the dev WebODM: a plain password
  encrypted at start, the saved login checked, a fresh database giving "can't be read", the password typed again and
  saved.
- **T1: the image sliders' steps halved** (2026-10-31). `SLIDERS` in `frontend/src/viewer/view.ts`; tests in
  `frontend/tests/view.test.ts` (steps half of F1's, both ends reached) and `frontend/tests/viewer.test.tsx`.
- **W1: the docs site** (2026-10-31). `docs/` laid out in `zensical.toml` (Getting started, Quickstart, the user
  guide, Reference; each page says what it will hold), Zensical 0.0.73 in the `docs` dependency group, built strictly
  into `static/docs` (gitignored) with the browser's own fonts so the copy in the app works offline. `/help/` serves
  it (`help_page` in `analyzer/views.py`; `help_missing.html` without a build); the header's Help opens the guide's
  page for the page shown in a new tab (`helpUrl`, `HELP_PAGES` in `components/header.tsx`). `check_dist.py` allows
  and requires it, `smoke.py` fetches `/help/`, CI and `dji-thermal-ui.sh build` build it.
  `scripts/publish_docs.py` commits it in a clone of the public `dji-thermal-ui-docs` repository, never pushing.
  Upkeep: `.claude/skills/update-docs`, pointed to from CLAUDE.md. Tests: `tests/test_pages.py` (help),
  `tests/test_docs.py`, `tests/test_publish_docs.py`, `tests/test_script.py`, `frontend/tests/header.test.tsx`.
  Checked in Chromium on a scratch instance: the link, the new tab, the docs light and dark, the search, and no
  request leaving 127.0.0.1.
- **W2: the user guide** (2026-11-01). The README's feature list and its sections written as the documentation's
  pages: Getting started (`docs/getting-started/`), the user guide (`docs/guide/`, a page per part of the app, its
  labels checked in the code) and Reference (`docs/reference/`: the command, its environment variables,
  `dji-thermal-ui.sh`, the data and config folders on each system). The README keeps what the app is (a list linking
  to the guide), Install, Run, Development and Licence. `tests/test_docs.py` also checks links to headings, which
  the strict build doesn't. Checked: pytest 436, the header test, the strict build, check_dist and twine on the
  README, and `/help/` in Chromium in light and dark on an 8081 instance.
- **W3: quickstart tutorials with screenshots** (2026-11-01). `scripts/screenshots.mjs` (`npm run screenshots --
  <images>`, Playwright 1.64.1 pinned) makes the 30 shots in `docs/assets/screenshots/` on its own instance (8081,
  scratch folders, the data folder set through the config folder's `data-dir`), through the pages as a first-time
  user, in about 5 minutes on the 654 images of "m4t-test-flights"; no basemap, a shot showing the flight's
  coordinates fails, serial numbers and the data folder's path masked. Six tutorials in `docs/quickstart/`, one or
  two shots on each user guide page; `tests/test_docs.py` fails on a shot no page shows. Checked: pytest 437, Vitest
  447, ruff and lint, the strict build, check_dist, twine, the smoke check of the wheel (5.2 MB), and the pages in
  Chromium in light and dark.
- **X1: platforms checked** (2026-11-01). CI's `macos` job (`.github/workflows/ci.yml`: pytest on 3.12 and the wheel's
  smoke check, in one job) runs only while the repository variable `MACOS_CI` is `true`. The full suite run natively
  on Windows (3.12 and 3.14) and the wheel's smoke check there found: WebODM's raster paths saved with `\`
  (`webodm_tasks.py`, now `/`), a kept histogram's `os.replace` that fails while another request reads it
  (`thermal_measure.kept_histogram`, now best-effort), and test-only issues (Windows' coarse clock in the token test,
  a path compared as a string). An import now says so when this computer can't keep a file (`restore.py`: Windows'
  refused characters, names that fold into one, any `OSError` opening it; `tests/test_api_import.py`). Python 3.14's
  `ResourceWarning` for an `HTTPError` left open failed 13 tests on every system; fixed on main first
  (`fix-py314-http-errors`). The script has no bash 4 features (macOS's bash is 3.2); the platform-guarded tests all
  check real differences. CLAUDE.md's Mac list is now what the macOS job runs. Checked: pytest on Linux (3.12, 3.14)
  and Windows (3.12, 3.14), ruff, the strict docs build, check_dist, and the smoke check on Windows.
- **N1: the name and the banner** (2026-11-01). The shown name is DJI Thermal Analyzer (the header, the page titles,
  hints and messages, the docs' site name, the README's title; the tests and `scripts/smoke.py` follow); the command,
  package and repositories keep `dji-thermal-ui`, and the front end's storage keys keep `thermal-analyzer.*`. The
  banner's source is `branding/dji-thermal-analyzer.jpg` (outside `docs/`); `scripts/banner.py` makes
  `docs/assets/banner-1600.jpg` and `banner-2400.jpg`, shown on the docs' home page and, from the docs site's address,
  in the README; `check_dist.py` allows `.jpg` in the docs. The 30 screenshots made again (in a worktree with its own
  environment, as the user's 8080 serves this checkout). Checked: pytest 438, Vitest 447, ruff and lint, the strict
  build, check_dist, twine, the smoke check (wheel 5.8 MB), and the header at 375 and 800 px.
