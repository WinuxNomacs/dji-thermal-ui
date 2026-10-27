# Upcoming changes

Deferred work, tracked here so it isn't lost between sessions.

## Phases (current and upcoming)

The order of work, top first. Each phase is planned with the user before it is built; the details are in the
sections below. New requests arrive in `new.md`: they are turned into phases here, and `new.md` is cleared back to
its title.

**Up next**
1. **C2: the source frames pop-out**: a spot or area on the mosaic opens its source frames in a window on the page,
   on the viewer and the compare page; the Source frame tab opens it on a click. (Findings)
2. **C3: findings on the viewer**: a spot or area saved as a finding of the dataset, with its source frames, notes,
   severity, status and temperatures; shown or hidden; a measurement saved as a finding. (Findings)
3. **C4: findings on the compare page.** (Findings)

**Then**
1. **D1: the dataset report**, printed to PDF from the browser. (Reports)
2. **D2: the mosaic report**, with its measurements and findings. (Reports)

**Later**
1. **ODM processing through LuxODM's or WebODM's REST API**: send a conversion's temperature TIFFs as a task with
   the plan's options, and follow it. This replaces the plugin's "Process in LuxODM". (Integration)

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

- Findings shown on both panes with their own switch, opened in each pane's pop-out, and saved from a spot or area
  drawn in a pane.

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

- `/dataset/<id>/report`, opened from the dataset page: the title block; the dataset (files, size, thermal frames,
  cameras, when it was flown, altitudes, where, with the frames' positions on a map); the problems from the analysis;
  the frames' settings and temperature ranges; the conversions made; and, once C3 is built, the findings.
- The report's text saved on the dataset. Print styles: no header or controls, always light, figures kept whole on
  a page.

### D2: the mosaic report

- `/conversion/<id>/report`, opened from the viewer with its view: the contents decided above, and the dataset's
  findings on this mosaic with their kept frames. Each measurement's comment saved on the measurement (shown in the
  viewer and in the CSV and GeoJSON too).
- Tests for both: pytest for the pages and the saved text; Vitest for the sections from the data; a live check
  printing each to PDF with Playwright and looking at the pages.

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

- **Built** (2026-10-27): see Done. The findings counts and the project's findings together wait for C3; the form
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
